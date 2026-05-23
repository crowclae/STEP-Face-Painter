////////////////////////////////////////////////////////////
// main.js  –  STEP Face Viewer (FaceID Mode)
//
//  - opencascade.js (WASM) で STEP を読み込み
//  - TopExp_Explorer でフェイスを列挙 → 各頂点に faceId を付与
//  - インデックス付き BufferGeometry で頂点を共有
//  - tris.Normal(v) による解析的頂点法線（円柱・球が滑らか）
//  - REVERSED フェイスは巻き順を反転して法線方向を統一
//  - BFS なし：faceGroupMap の完全一致で塗りつぶし
//  - coi-serviceworker.js が COOP/COEP ヘッダを注入
////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////
// Imports (★インポートマップ経由でローカルを参照)
////////////////////////////////////////////////////////////

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';


////////////////////////////////////////////////////////////
// HTML Elements
////////////////////////////////////////////////////////////

const canvas            = document.getElementById('viewer');
const stepFileInput     = document.getElementById('stepFile');
const colorPicker       = document.getElementById('colorPicker');
const loading           = document.getElementById('loading');
const faceIdLabel       = document.getElementById('faceId');
const meshNameLabel     = document.getElementById('meshName');
const triCountLabel     = document.getElementById('triCount');
const viewerContainer   = document.getElementById('viewer-container');
const undoButton        = document.getElementById('undoButton');
const saveColorsButton  = document.getElementById('saveColorsButton');
const importColorsFile  = document.getElementById('importColorsFile');
const toggleEdgesButton = document.getElementById('toggleEdgesButton');
const toggleGridButton  = document.getElementById('toggleGridButton');

// ★追加: 視点・センタリングボタンの取得
const viewPosXBtn = document.getElementById('viewPosX');
const viewNegXBtn = document.getElementById('viewNegX');
const viewPosYBtn = document.getElementById('viewPosY');
const viewNegYBtn = document.getElementById('viewNegY');
const viewPosZBtn = document.getElementById('viewPosZ');
const viewNegZBtn = document.getElementById('viewNegZ');
const centerButton = document.getElementById('centerButton');

////////////////////////////////////////////////////////////
// Scene
////////////////////////////////////////////////////////////

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);


////////////////////////////////////////////////////////////
// Camera (修正版: OrthographicCamera)
////////////////////////////////////////////////////////////

// 表示領域のサイズ（値が大きいほど広範囲が見えます。後でオブジェクトに合わせて自動調整されます）
const viewSize = 300;
const aspect = window.innerWidth / window.innerHeight;

const camera = new THREE.OrthographicCamera(
    -viewSize * aspect / 2, // Left
     viewSize * aspect / 2, // Right
     viewSize / 2,          // Top
    -viewSize / 2,          // Bottom
    0.1,                    // Near
    100000                  // Far
);
// カメラの位置（パースが効かないため、位置の「距離」は見た目の大きさに影響せず「方向」のみに影響します）
camera.position.set(150, 120, 150);


////////////////////////////////////////////////////////////
// Renderer
////////////////////////////////////////////////////////////

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);


////////////////////////////////////////////////////////////
// Controls
////////////////////////////////////////////////////////////

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;


////////////////////////////////////////////////////////////
// Lights
////////////////////////////////////////////////////////////

scene.add(new THREE.AmbientLight(0xffffff, 1.4));

const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
dirLight.position.set(100, 150, 100);
scene.add(dirLight);


////////////////////////////////////////////////////////////
// Grid
////////////////////////////////////////////////////////////

//scene.add(new THREE.GridHelper(500, 50, 0x444444, 0x2a2a2a));


////////////////////////////////////////////////////////////
// Raycaster
////////////////////////////////////////////////////////////

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();


////////////////////////////////////////////////////////////
// State
////////////////////////////////////////////////////////////

let currentModel    = null;
let faceGroupMap    = null;   // Map<faceId, 三角形インデックス[]>
let faceIdPerVertex = null;   // Float32Array: 頂点インデックス → faceId
let isLeftMouseDown = false;
let isRotating      = false;
let colorHistory    = [];
const MAX_HISTORY   = 20;
let showEdges       = true;
let showGrid        = true;
colorPicker.value = '#3498db';

////////////////////////////////////////////////////////////
// opencascade.js 初期化
// ★ローカルに配置したJSファイルとWASMファイルを動的インポート
////////////////////////////////////////////////////////////

loading.style.display = 'block';
loading.innerText = 'Loading opencascade.js WASM...';

const oc = await import('./libs/opencascade/opencascade.full.js')
    .then(({ default: OpenCascade }) => OpenCascade({
        locateFile: (path) => `./libs/opencascade/${path}`
    }));

loading.innerText = 'Drop STEP File';
console.log('OpenCascade.js Ready', oc);


////////////////////////////////////////////////////////////
// STEP ファイル読み込みイベント
////////////////////////////////////////////////////////////

stepFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await loadStepFile(file);
});

viewerContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    viewerContainer.classList.add('dragover');
});
viewerContainer.addEventListener('dragleave', () => {
    viewerContainer.classList.remove('dragover');
});
viewerContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    viewerContainer.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) await loadStepFile(file);
});


////////////////////////////////////////////////////////////
// STEP Loader
////////////////////////////////////////////////////////////

async function loadStepFile(file) {
    try {
        loading.style.display = 'block';
        loading.innerText = 'Reading STEP file...';

        // 旧モデルの破棄
        if (currentModel) {
            scene.remove(currentModel);
            currentModel.traverse((child) => {
                if (child.isMesh || child.isLineSegments) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
            currentModel = null;
        }

        faceGroupMap    = null;
        faceIdPerVertex = null;
        colorHistory    = [];

        // ArrayBuffer → Uint8Array → 仮想 FS
        const fileData = new Uint8Array(await file.arrayBuffer());
        oc.FS.createDataFile('/', 'model.step', fileData, true, true, true);

        // ---- STEP 読み込み ----
        loading.innerText = 'Parsing STEP geometry...';

        const reader     = new oc.STEPControl_Reader_1();
        const readResult = reader.ReadFile('model.step');
        oc.FS.unlink('/model.step');

        if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new Error('STEP read failed. Status: ' + readResult);
        }

        reader.TransferRoots(new oc.Message_ProgressRange_1());
        const shape = reader.OneShape();

        // ---- メッシュ化 ----
        loading.innerText = 'Tessellating faces...';
        new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

        // ---- フェイスごとに頂点・法線・インデックスを収集 ----
        loading.innerText = 'Building FaceID map...';

        const allPositions = [];  
        const allNormals   = [];  
        const allIndices   = [];  
        const allFaceIds   = [];  

        const faceGroupTmp = new Map();  

        const explorer = new oc.TopExp_Explorer_1();
        explorer.Init(
            shape,
            oc.TopAbs_ShapeEnum.TopAbs_FACE,
            oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        );

        let faceId       = 0;
        let vertexOffset = 0;  
        let triCounter   = 0;  

        while (explorer.More()) {
            const face       = oc.TopoDS.Face_1(explorer.Current());
            const location   = new oc.TopLoc_Location_1();
            const polyHandle = oc.BRep_Tool.Triangulation(face, location);

            if (polyHandle.IsNull()) {
                explorer.Next();
                faceId++;
                continue;
            }

            const tris       = polyHandle.get();
            const nNodes     = tris.NbNodes();
            const nTris      = tris.NbTriangles();
            const hasTrsf    = !location.IsIdentity();
            const trsf       = hasTrsf ? location.Transformation() : null;
            const isReversed = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
            const sign       = isReversed ? -1 : 1;
            const hasNormals = tris.HasNormals();

            for (let v = 1; v <= nNodes; v++) {
                const pnt = tris.Node(v);
                let x = pnt.X(), y = pnt.Y(), z = pnt.Z();

                if (hasTrsf && trsf) {
                    const tp = pnt.Transformed(trsf);
                    x = tp.X(); y = tp.Y(); z = tp.Z();
                }
                allPositions.push(x, y, z);
                allFaceIds.push(faceId);

                if (hasNormals) {
                    const n = tris.Normal(v);
                    allNormals.push(n.X() * sign, n.Y() * sign, n.Z() * sign);
                } else {
                    allNormals.push(0, 1, 0);
                }
            }

            const triGroup = [];

            for (let t = 1; t <= nTris; t++) {
                const tri = tris.Triangle(t);
                const i1  = tri.Value(1) - 1 + vertexOffset;
                const i2  = tri.Value(2) - 1 + vertexOffset;
                const i3  = tri.Value(3) - 1 + vertexOffset;

                if (isReversed) {
                    allIndices.push(i1, i3, i2);
                } else {
                    allIndices.push(i1, i2, i3);
                }
                triGroup.push(triCounter++);
            }

            faceGroupTmp.set(faceId, triGroup);
            vertexOffset += nNodes;
            faceId++;
            explorer.Next();
        }

        if (allPositions.length === 0) {
            throw new Error('No triangles found. STEP file may be empty or invalid.');
        }

        // ---- Three.js BufferGeometry ----
        loading.innerText = 'Building Three.js geometry...';

        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(allPositions, 3)
        );
        geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(allNormals, 3)
        );

        const faceIdArray = new Float32Array(allFaceIds);
        geometry.setAttribute(
            'faceId',
            new THREE.BufferAttribute(faceIdArray, 1)
        );

        geometry.setIndex(allIndices);

        const normalAttr = geometry.attributes.normal;
        const hasZeroNormal = allNormals.some((v, i) =>
            i % 3 === 1 && allNormals[i-1] === 0 && v === 1 && allNormals[i+1] === 0
        );
        if (hasZeroNormal) {
            geometry.computeVertexNormals();
        }

        const vertexCount = allPositions.length / 3;
        const defaultColor = new THREE.Color('#3498db'); 
        const colors = new Float32Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i++) {
            colors[i * 3]     = defaultColor.r;
            colors[i * 3 + 1] = defaultColor.g;
            colors[i * 3 + 2] = defaultColor.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness:    0.05,
            roughness:    0.65,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.name = file.name;
        mesh.castShadow    = true;
        mesh.receiveShadow = true;

        const edgesGeometry = new THREE.EdgesGeometry(geometry, 24);
        const edgesMaterial = new THREE.LineBasicMaterial({ 
            color: 0x555555, 
            linewidth: 1     
        });
        const edgeLines = new THREE.LineSegments(edgesGeometry, edgesMaterial);
        edgeLines.name = 'edgeLines';
        edgeLines.visible = showEdges; 

        currentModel = new THREE.Group();
        currentModel.add(mesh);
        currentModel.add(edgeLines); 
        scene.add(currentModel);

        faceGroupMap    = faceGroupTmp;
        faceIdPerVertex = faceIdArray;

        triCountLabel.innerText = triCounter.toLocaleString();
        fitCameraToObject(currentModel);

        loading.style.display = 'none';
        console.log(`STEP loaded: ${faceId} faces, ${triCounter} triangles`);

    } catch (err) {
        console.error(err);
        loading.innerText = `❌ Load failed: ${err.message}`;
    }
}


////////////////////////////////////////////////////////////
// Paint Core
////////////////////////////////////////////////////////////

function checkAndPaint(clientX, clientY, isFirstClick = false) {
    if (!currentModel || !faceGroupMap) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(currentModel.children, true);
    if (intersects.length === 0) return;

    const intersect = intersects.find(hit => hit.object.isMesh);
    if (!intersect) return;

    const hitTriangle = intersect.faceIndex;
    if (hitTriangle === undefined) return;

    const geometry   = intersect.object.geometry;
    const indexAttr  = geometry.index;
    const faceIdAttr = geometry.attributes.faceId;

    const vertexIndex = indexAttr.getX(hitTriangle * 3);
    const faceIdVal   = Math.round(faceIdAttr.getX(vertexIndex));

    faceIdLabel.innerText   = faceIdVal;
    meshNameLabel.innerText = `Face_${faceIdVal}`;

    const targetMesh  = intersect.object;
    const sameIdTris  = faceGroupMap.get(faceIdVal) || [];

    if (isFirstClick) saveHistory(targetMesh);
    applyColorToFaceGroup(targetMesh, sameIdTris, colorPicker.value);
}


////////////////////////////////////////////////////////////
// 指定三角形グループに頂点カラーを適用
////////////////////////////////////////////////////////////

function applyColorToFaceGroup(mesh, triangleIndices, hexColor) {
    const geometry  = mesh.geometry;
    const colorAttr = geometry.attributes.color;
    const indexAttr = geometry.index;
    if (!colorAttr || !indexAttr) return;

    const color = new THREE.Color(hexColor);

    for (const tIdx of triangleIndices) {
        const v0 = indexAttr.getX(tIdx * 3);
        const v1 = indexAttr.getX(tIdx * 3 + 1);
        const v2 = indexAttr.getX(tIdx * 3 + 2);
        colorAttr.setXYZ(v0, color.r, color.g, color.b);
        colorAttr.setXYZ(v1, color.r, color.g, color.b);
        colorAttr.setXYZ(v2, color.r, color.g, color.b);
    }
    colorAttr.needsUpdate = true;
}


////////////////////////////////////////////////////////////
// Pointer Events
////////////////////////////////////////////////////////////

canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && !e.shiftKey && !e.ctrlKey) {
        isLeftMouseDown = true;
        isRotating      = false;
        checkAndPaint(e.clientX, e.clientY, true);
    } else {
        isRotating = true;
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (isLeftMouseDown && !isRotating) {
        controls.enabled = false;
        checkAndPaint(e.clientX, e.clientY, false);
    }
});

const stopPainting = () => {
    isLeftMouseDown  = false;
    isRotating       = false;
    controls.enabled = true;
};
window.addEventListener('pointerup', stopPainting);
canvas.addEventListener('pointerleave', stopPainting);


////////////////////////////////////////////////////////////
// Palette
////////////////////////////////////////////////////////////

colorPicker.addEventListener('input', (e) => {
    console.log('Brush color:', e.target.value);
});

document.querySelectorAll('.palette-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        colorPicker.value = e.currentTarget.getAttribute('data-color');
    });
});


////////////////////////////////////////////////////////////
// Undo
////////////////////////////////////////////////////////////

function saveHistory(mesh) {
    const attr = mesh.geometry.attributes.color;
    if (!attr) return;
    colorHistory.push(new Float32Array(attr.array));
    if (colorHistory.length > MAX_HISTORY) colorHistory.shift();
}

undoButton.addEventListener('click', () => {
    if (!colorHistory.length || !currentModel) return;
    const mesh = currentModel.children[0];
    if (!mesh) return;
    const attr = mesh.geometry.attributes.color;
    if (!attr) return;
    attr.array.set(colorHistory.pop());
    attr.needsUpdate = true;
});

////////////////////////////////////////////////////////////
// Grid
////////////////////////////////////////////////////////////

const gridHelper = new THREE.GridHelper(500, 50, 0x444444, 0x2a2a2a);
gridHelper.name = 'gridHelper'; // ★これを追記（後から探し出せるように名前を付ける）
scene.add(gridHelper);

////////////////////////////////////////////////////////////
// Save / Load Color JSON
////////////////////////////////////////////////////////////

saveColorsButton.addEventListener('click', () => {
    if (!currentModel) { alert('モデルが読み込まれていません。'); return; }
    const mesh = currentModel.children[0];
    const attr = mesh?.geometry?.attributes?.color;
    if (!attr)  { alert('カラーデータがありません。'); return; }

    const exportData = {
        application:      'STEP Face Viewer – FaceID Mode',
        timestamp:        Date.now(),
        vertexColorCount: attr.array.length,
        colors:           Array.from(attr.array),
    };

    const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: 'step-colors.json',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    console.log('Color state saved.');
});

importColorsFile.addEventListener('change', (e) => {
    if (!currentModel) {
        alert('最初に STEP ファイルを読み込んでください。');
        e.target.value = '';
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            const mesh = currentModel.children[0];
            const attr = mesh?.geometry?.attributes?.color;
            if (!attr) { alert('ジオメトリが無効です。'); return; }
            if (data.vertexColorCount !== attr.array.length) {
                alert('ポリゴン数が異なります。同じ STEP ファイルを使用してください。');
                return;
            }
            saveHistory(mesh);
            attr.array.set(data.colors);
            attr.needsUpdate = true;
            alert('カラーデータを復元しました。');
        } catch (err) {
            console.error(err);
            alert('JSON 読み込み失敗: ' + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
});


////////////////////////////////////////////////////////////
// Camera Fit (修正版: OrthographicCamera用)
////////////////////////////////////////////////////////////

function fitCameraToObject(obj) {
    const box    = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // オブジェクトが画面に収まるように OrthographicCamera の表示範囲（ズーム）を調整
    const aspect = window.innerWidth / window.innerHeight;
    
    // 余裕を持たせるためのマージン（1.2倍）
    const baseSize = maxDim * 1.2;

    camera.left   = -baseSize * aspect / 2;
    camera.right  =  baseSize * aspect / 2;
    camera.top    =  baseSize / 2;
    camera.bottom = -baseSize / 2;

    // 現在のカメラの向き（ベクトル）を維持したまま、中心位置を基準にカメラを後ろに下げる
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    camera.position.copy(center).addScaledVector(dir, maxDim * 2);

    controls.target.copy(center);
    
    camera.near = maxDim / 100;
    camera.far  = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.update();
}

////////////////////////////////////////////////////////////
// Toggle Edges Command
////////////////////////////////////////////////////////////

if (toggleEdgesButton) {
    toggleEdgesButton.addEventListener('click', () => {
        if (!currentModel) return;

        showEdges = !showEdges;
        toggleEdgesButton.innerText = showEdges ? 'エッジ非表示' : 'エッジ表示';

        const edgeLines = currentModel.getObjectByName('edgeLines');
        if (edgeLines) {
            edgeLines.visible = showEdges;
        }
    });
}

////////////////////////////////////////////////////////////
// Toggle Grid Command（★これを新規追記）
////////////////////////////////////////////////////////////

if (toggleGridButton) {
    toggleGridButton.addEventListener('click', () => {
        // 状態を反転
        showGrid = !showGrid;
        
        // ボタンのテキストを更新
        toggleGridButton.innerText = showGrid ? 'グリッド非表示' : 'グリッド表示';

        // シーン全体から名前をキーにグリッドオブジェクトを探す
        const grid = scene.getObjectByName('gridHelper');
        if (grid) {
            grid.visible = showGrid; // 可視性を切り替え
        }
    });
}

////////////////////////////////////////////////////////////
// ★追加: カメラ視点切り替え & センタリング
////////////////////////////////////////////////////////////

// 現在のターゲットからの距離を維持して、指定した軸方向へカメラを移動する
function setCameraDirection(axis, sign) {
    if (!controls) return;

    // 現在のターゲット（注視点）を取得
    const target = controls.target.clone();
    
    // 現在のカメラとターゲットの距離を計算（距離を維持するため）
    const distance = camera.position.distanceTo(target);

    // 新しいカメラ位置の計算
    const newPos = target.clone();
    if (axis === 'x') newPos.x += distance * sign;
    if (axis === 'y') newPos.y += distance * sign;
    if (axis === 'z') newPos.z += distance * sign;

    camera.position.copy(newPos);

    // 真上・真下（+Y, -Y）を向いたときにカメラのUPベクトルがジンバルロックを起こさないよう補正
    if (axis === 'y') {
        camera.up.set(0, 0, sign === 1 ? -1 : 1);
    } else {
        camera.up.set(0, 1, 0); // 通常はY軸が上
    }

    controls.update();
}

// 各ボタンのイベントリスナー登録
viewPosXBtn.addEventListener('click', () => setCameraDirection('x', 1));
viewNegXBtn.addEventListener('click', () => setCameraDirection('x', -1));
viewPosYBtn.addEventListener('click', () => setCameraDirection('y', 1));
viewNegYBtn.addEventListener('click', () => setCameraDirection('y', -1));
viewPosZBtn.addEventListener('click', () => setCameraDirection('z', 1));
viewNegZBtn.addEventListener('click', () => setCameraDirection('z', -1));

////////////////////////////////////////////////////////////
// センタリングボタンの処理（修正版）
////////////////////////////////////////////////////////////
centerButton.addEventListener('click', () => {
    if (!currentModel || !controls) return;

    // 1. オブジェクト（グリッド以外）の中心座標を計算
    const box = new THREE.Box3().setFromObject(currentModel);
    const newCenter = box.getCenter(new THREE.Vector3());

    // 2. 現在のターゲット（注視点）から新しい中心への移動量を計算
    const oldCenter = controls.target.clone();
    const offset = new THREE.Vector3().subVectors(newCenter, oldCenter);

    // 3. カメラの位置とコントロールのターゲットを、同じ移動量だけ平行移動
    camera.position.add(offset);
    controls.target.copy(newCenter);

    // コントロールを更新して画面に反映
    controls.update();
    
    console.log('Centered object while keeping current view angle.');
});

////////////////////////////////////////////////////////////
// Resize (修正版: OrthographicCamera用)
////////////////////////////////////////////////////////////

window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    
    // 現在の表示幅（高さ基準）を維持したまま左右の範囲を再計算
    const currentHeight = camera.top - camera.bottom;
    
    camera.left   = -currentHeight * aspect / 2;
    camera.right  =  currentHeight * aspect / 2;
    // top と bottom は維持
    
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


////////////////////////////////////////////////////////////
// Animate
////////////////////////////////////////////////////////////

(function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
})();
