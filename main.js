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

// 視点・センタリングボタンの取得
const viewPosXBtn = document.getElementById('viewPosX');
const viewNegXBtn = document.getElementById('viewNegX');
const viewPosYBtn = document.getElementById('viewPosY');
const viewNegYBtn = document.getElementById('viewNegY');
const viewPosZBtn = document.getElementById('viewPosZ');
const viewNegZBtn = document.getElementById('viewNegZ');
const centerButton = document.getElementById('centerButton');

// 右側タグメニュー用
const tagFieldsContainer = document.getElementById('tagFieldsContainer');

////////////////////////////////////////////////////////////
// 確認モーダル
////////////////////////////////////////////////////////////

const confirmModalOverlay = document.getElementById('confirm-modal-overlay');
const confirmModalOk      = document.getElementById('confirm-modal-ok');
const confirmModalCancel  = document.getElementById('confirm-modal-cancel');

/**
 * モーダルを表示し、ユーザーの選択を Promise で返す。
 * @returns {Promise<boolean>} 続行なら true、キャンセルなら false
 */
function showConfirmModal() {
    return new Promise((resolve) => {
        confirmModalOverlay.classList.add('active');

        function onOk() {
            cleanup();
            resolve(true);
        }
        function onCancel() {
            cleanup();
            resolve(false);
        }
        function onOverlayClick(e) {
            if (e.target === confirmModalOverlay) {
                cleanup();
                resolve(false);
            }
        }
        function onKeyDown(e) {
            if (e.key === 'Escape') { cleanup(); resolve(false); }
            if (e.key === 'Enter')  { cleanup(); resolve(true);  }
        }

        function cleanup() {
            confirmModalOverlay.classList.remove('active');
            confirmModalOk.removeEventListener('click', onOk);
            confirmModalCancel.removeEventListener('click', onCancel);
            confirmModalOverlay.removeEventListener('click', onOverlayClick);
            document.removeEventListener('keydown', onKeyDown);
        }

        confirmModalOk.addEventListener('click', onOk);
        confirmModalCancel.addEventListener('click', onCancel);
        confirmModalOverlay.addEventListener('click', onOverlayClick);
        document.addEventListener('keydown', onKeyDown);
    });
}

////////////////////////////////////////////////////////////
// Preset Colors Configuration (左パレットと同じ10色)
////////////////////////////////////////////////////////////
const presetColors = [
    { hex: '#e74c3c', name: 'Red' },
    { hex: '#e67e22', name: 'Orange' },
    { hex: '#f1c40f', name: 'Yellow' },
    { hex: '#2ecc71', name: 'Green' },
    { hex: '#3498db', name: 'Blue' },
    { hex: '#9b59b6', name: 'Purple' },
    { hex: '#1abc9c', name: 'Teal' },
    { hex: '#ecf0f1', name: 'White' },
    { hex: '#7f8c8d', name: 'Gray' },
    { hex: '#b2bec3', name: 'Silver' }
];

////////////////////////////////////////////////////////////
// 右側メニューのTag入力用UIを動的に生成
////////////////////////////////////////////////////////////
function initTagFields() {
    tagFieldsContainer.innerHTML = '';
    presetColors.forEach((preset, index) => {
        const row = document.createElement('div');
        row.className = 'tag-row';

        // 色表示（クリックするとその色を選択できるショートカットに）
        const indicator = document.createElement('div');
        indicator.className = 'tag-color-indicator';
        indicator.style.backgroundColor = preset.hex;
        indicator.title = `パレットカラー ${index + 1}: ${preset.name} をブラシに適用`;
        indicator.addEventListener('click', () => {
            colorPicker.value = preset.hex;
            console.log('Brush color changed via tag panel:', preset.hex);
        });

        // Tag入力欄
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-input';
        input.placeholder = `プリセット ${index + 1} のTag情報`;
        input.id = `tag-input-${index}`;

        row.appendChild(indicator);
        row.appendChild(input);
        tagFieldsContainer.appendChild(row);
    });
}
initTagFields();

////////////////////////////////////////////////////////////
// Scene
////////////////////////////////////////////////////////////

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);


////////////////////////////////////////////////////////////
// Camera (OrthographicCamera)
////////////////////////////////////////////////////////////

const viewSize = 300;
const aspect = window.innerWidth / window.innerHeight;

const camera = new THREE.OrthographicCamera(
    -viewSize * aspect / 2, 
     viewSize * aspect / 2, 
     viewSize / 2,          
    -viewSize / 2,          
    0.1,                    
    100000                  
);
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
let hoveredFaceId = null;       // 現在ホバーしているFaceID
let highlightEdgeMesh = null;   // ハイライト表示用のラインメッシュ
colorPicker.value = '#e74c3c';

////////////////////////////////////////////////////////////
// opencascade.js 初期化
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
    if (!file) return;
    if (currentModel) {
        const confirmed = await showConfirmModal();
        if (!confirmed) {
            e.target.value = ''; // 選択をリセット
            return;
        }
    }
    await loadStepFile(file);
    e.target.value = ''; // 同じファイルの再選択も可能にする
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
    if (!file) return;
    if (currentModel) {
        const confirmed = await showConfirmModal();
        if (!confirmed) return;
    }
    await loadStepFile(file);
});


////////////////////////////////////////////////////////////
// STEP Loader
////////////////////////////////////////////////////////////

async function loadStepFile(file) {
    try {
        loading.style.display = 'block';
        loading.innerText = 'Reading STEP file...';

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

        const fileData = new Uint8Array(await file.arrayBuffer());
        oc.FS.createDataFile('/', 'model.step', fileData, true, true, true);

        loading.innerText = 'Parsing STEP geometry...';

        const reader     = new oc.STEPControl_Reader_1();
        const readResult = reader.ReadFile('model.step');
        oc.FS.unlink('/model.step');

        if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new Error('STEP read failed. Status: ' + readResult);
        }

        reader.TransferRoots(new oc.Message_ProgressRange_1());
        const shape = reader.OneShape();

        loading.innerText = 'Tessellating faces...';
        new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

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

        const hasZeroNormal = allNormals.some((v, i) =>
            i % 3 === 1 && allNormals[i-1] === 0 && v === 1 && allNormals[i+1] === 0
        );
        if (hasZeroNormal) {
            geometry.computeVertexNormals();
        }

        const vertexCount = allPositions.length / 3;
        const defaultColor = new THREE.Color('#ecf0f1'); 
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
// マウスオーバー時のハイライト処理（面とエッジの両方を強調）
////////////////////////////////////////////////////////////

// ハイライト表示用のオブジェクトを保持する変数（トップレベルのStateに追加・変更）
let highlightGroup = null; // LineSegments から Group もしくは単一のコンテナに変更するため

function updateHighlight(clientX, clientY) {
    if (!currentModel || !faceGroupMap) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    camera.updateProjectionMatrix();
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObjects(currentModel.children, true);
    const intersect = intersects.find(hit => hit.object.isMesh);
    
    if (!intersect) {
        clearHighlight();
        return;
    }

    const hitTriangle = intersect.faceIndex;
    if (hitTriangle === undefined) return;

    const geometry   = intersect.object.geometry;
    const indexAttr  = geometry.index;
    const faceIdAttr = geometry.attributes.faceId;

    const vertexIndex = indexAttr.getX(hitTriangle * 3);
    const faceIdVal   = Math.round(faceIdAttr.getX(vertexIndex));

    if (hoveredFaceId === faceIdVal) return;
    hoveredFaceId = faceIdVal;

    clearHighlight();

    const sameIdTris = faceGroupMap.get(faceIdVal) || [];
    if (sameIdTris.length === 0) return;

    const posAttr = geometry.attributes.position;
    
    const localPositions = [];
    const localIndices = [];
    const vertexMap = new Map();
    let localVertexCounter = 0;

    for (const tIdx of sameIdTris) {
        const gIdxs = [
            indexAttr.getX(tIdx * 3),
            indexAttr.getX(tIdx * 3 + 1),
            indexAttr.getX(tIdx * 3 + 2)
        ];

        for (const gIdx of gIdxs) {
            if (!vertexMap.has(gIdx)) {
                vertexMap.set(gIdx, localVertexCounter);
                localPositions.push(posAttr.getX(gIdx), posAttr.getY(gIdx), posAttr.getZ(gIdx));
                localVertexCounter++;
            }
            localIndices.push(vertexMap.get(gIdx));
        }
    }

    // ハイライト専用のバッファジオメトリ
    const highlightGeom = new THREE.BufferGeometry();
    highlightGeom.setAttribute('position', new THREE.Float32BufferAttribute(localPositions, 3));
    highlightGeom.setIndex(localIndices);

    // --- ここから面とエッジのハイライトオブジェクト生成 ---
    
    // 1. 複数のハイライトオブジェクトをまとめるグループを作成
    highlightGroup = new THREE.Group();
    highlightGroup.name = 'dynamicHighlightGroup';

    // 2. 面（Face）のハイライト設定（半透明の赤でトーンを変化させる）
    const faceMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.25,        // 不透明度（0.1〜0.3 程度が下地が見えて扱いやすいです）
        side: THREE.DoubleSide, // 裏返った面でもハイライトされるように
        depthTest: true,
        depthWrite: false     // 描画順によるバグを防ぐため深度バッファへの書き込みはOFF
    });
    const highlightMesh = new THREE.Mesh(highlightGeom, faceMat);
    highlightGroup.add(highlightMesh);

    // 3. エッジ（輪郭線）のハイライト設定
    const edgesGeom = new THREE.EdgesGeometry(highlightGeom, 24);
    const edgesMat = new THREE.LineBasicMaterial({
        color: 0xff0000,
        linewidth: 1,
        depthTest: true
    });
    const highlightEdgeMesh = new THREE.LineSegments(edgesGeom, edgesMat);
    highlightGroup.add(highlightEdgeMesh);

    // 親モデル（STEPの配置）にトランスフォームを同期
    highlightGroup.position.copy(intersect.object.position);
    highlightGroup.rotation.copy(intersect.object.rotation);
    highlightGroup.scale.copy(intersect.object.scale);
    
    // Zファイティング（チラつき）防止用の僅かなオフセット
    highlightGroup.scale.multiplyScalar(1.0005); 

    scene.add(highlightGroup);
}

// ハイライトを消去するヘルパー関数（グループ対応版）
function clearHighlight() {
    if (highlightGroup) {
        scene.remove(highlightGroup);
        highlightGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        highlightGroup = null;
    }
    hoveredFaceId = null;
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

    // 左クリックドラッグ中 → ペイント
    if (isLeftMouseDown && !isRotating) {

        controls.enabled = false;

        checkAndPaint(e.clientX, e.clientY, false);

        clearHighlight();

        return;
    }

    // 通常マウス移動 → ハイライト
    if (!isLeftMouseDown) {

        updateHighlight(e.clientX, e.clientY);

    }
});

// マウスがキャンバス外に出たらハイライトを消す処理も追加
canvas.addEventListener('pointerleave', () => {
    stopPainting();
    clearHighlight(); 
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
// Undo (★バグ修正: slice() でメモリ参照を切断し、値を複製する)
////////////////////////////////////////////////////////////

function saveHistory(mesh) {
    const attr = mesh?.geometry?.attributes?.color;
    if (!attr || !attr.array) return;
    // .slice()を呼ぶことで、参照元のメモリ空間とは独立したディープコピーを作成して保存します
    colorHistory.push(attr.array.slice());
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
gridHelper.name = 'gridHelper'; 
scene.add(gridHelper);

////////////////////////////////////////////////////////////
// Save / Load Color JSON (★FaceIDベースのマッピング方式に改良)
////////////////////////////////////////////////////////////

saveColorsButton.addEventListener('click', () => {
    if (!currentModel) { alert('モデルが読み込まれていません。'); return; }
    const mesh = currentModel.children[0];
    const geometry = mesh?.geometry;
    const colorAttr = geometry?.attributes?.color;
    const faceIdAttr = geometry?.attributes?.faceId;

    if (!colorAttr || !faceIdAttr) { alert('カラーデータまたはFaceIDデータがありません。'); return; }

    // 1. FaceIDごとの色を格納するマップ（FaceID -> HEXカラー）を作成
    const faceColorMap = {};
    const vertexCount = colorAttr.count;

    for (let i = 0; i < vertexCount; i++) {
        const fId = Math.round(faceIdAttr.getX(i));
        
        // すでにこのFaceIDの色を記録してあればスキップ（高速化）
        if (faceColorMap[fId] !== undefined) continue;

        // 頂点の色(RGB)を取得してHEX文字列に変換
        const r = colorAttr.getX(i);
        const g = colorAttr.getY(i);
        const b = colorAttr.getZ(i);
        const color = new THREE.Color(r, g, b);
        faceColorMap[fId] = "#" + color.getHexString();
    }

    // 2. 現在画面に入力されているTag情報を配列として取得
    const tagsData = presetColors.map((_, index) => {
        const inputEl = document.getElementById(`tag-input-${index}`);
        return inputEl ? inputEl.value : '';
    });

    // 3. エクスポートデータ構造の構築
    const exportData = {
        application: "STEP Face Viewer – FaceID Mode",
        timestamp: Date.now(),
        fileName: mesh.userData.name || "model.step",
        faceColors: faceColorMap, // ★頂点配列ではなく、[FaceID: 色] のペアを保存
        tags: tagsData
    };

    // 4. ファイルダウンロード処理
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'step-colors.json',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    console.log('Color mapping by FaceID and tags saved successfully.');
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
            const geometry = mesh?.geometry;
            const colorAttr = geometry?.attributes?.color;
            const faceIdAttr = geometry?.attributes?.faceId;

            if (!colorAttr || !faceIdAttr) { alert('ジオメトリが無効です。'); return; }

            // 互換性チェック: 古い「頂点数一致チェック」の代わりにFaceID用データがあるか確認
            if (!data.faceColors) {
                alert('互換性のない形式のJSONファイルです（FaceIDマッピングが含まれていません）。');
                return;
            }

            // 1. 読み込み前の状態をUndo履歴に入れる
            saveHistory(mesh);

            // 2. 画面上の全頂点をループし、JSON内のFaceIDに対応する色を1つずつ適用
            const vertexCount = colorAttr.count;
            const tempColor = new THREE.Color();
            let appliedCount = 0;

            for (let i = 0; i < vertexCount; i++) {
                const fId = Math.round(faceIdAttr.getX(i));
                const targetHex = data.faceColors[fId];

                // もしJSON内にそのFaceIDの色情報が記録されていれば適用
                if (targetHex !== undefined) {
                    tempColor.set(targetHex);
                    colorAttr.setXYZ(i, tempColor.r, tempColor.g, tempColor.b);
                    appliedCount++;
                }
            }

            // 変更を画面に反映
            colorAttr.needsUpdate = true;

            // 3. Tag情報の復元処理
            if (data.tags && Array.isArray(data.tags)) {
                data.tags.forEach((tagText, index) => {
                    const inputEl = document.getElementById(`tag-input-${index}`);
                    if (inputEl) {
                        inputEl.value = tagText || '';
                    }
                });
            }

            alert('FaceIDマッピングに基づき、カラーデータとTag情報を復元しました。');
            console.log(`Restored ${appliedCount} vertices using FaceID mapping.`);
        } catch (err) {
            console.error(err);
            alert('JSON 読み込み失敗: ' + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
});


////////////////////////////////////////////////////////////
// Camera Fit (OrthographicCamera用)
////////////////////////////////////////////////////////////

function fitCameraToObject(obj) {
    const box    = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const aspect = window.innerWidth / window.innerHeight;
    const baseSize = maxDim * 1.2;

    camera.left   = -baseSize * aspect / 2;
    camera.right  =  baseSize * aspect / 2;
    camera.top    =  baseSize / 2;
    camera.bottom = -baseSize / 2;

    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    camera.position.copy(center).addScaledVector(dir, maxDim * 2);

    controls.target.copy(center);
    
    camera.near = maxDim / 100;
    camera.far  = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.update();
}

////////////////////////////////////////////////////////////
// スクリーンショット機能（背景透過 PNG 保存）
////////////////////////////////////////////////////////////

const screenshotButton = document.getElementById('mode-badge');

if (screenshotButton) {
    screenshotButton.addEventListener('click', () => {
        if (!currentModel) {
            alert('モデルが読み込まれていません。');
            return;
        }

        // --- 1. キャプチャ前の準備（ハイライトを一時的に非表示） ---
        // マウスオーバーの赤枠や赤面が写り込まないように一時退避
        const currentHoveredId = hoveredFaceId;
        clearHighlight();

        // 背景を透過させるために、シーンの背景を一瞬だけ null (透明) に設定
        const originalBackground = scene.background;
        scene.background = null;

        // renderer の clearAlpha を 0 に設定（透過許可）
        const originalClearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);

        // --- 2. キャプチャ用の明示的なレンダリング ---
        // 画面サイズそのままで描画バッファを確定させる
        renderer.render(scene, camera);

        // --- 3. データ抽出とダウンロード処理 ---
        try {
            // WebGL から DataURL (PNG) を取得
            const dataURL = canvas.toDataURL('image/png');

            // ファイル名用のタイムスタンプを作成
            const now = new Date();
            const timeStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const modelName = currentModel.children[0]?.userData.name || "model";
            const cleanName = modelName.replace(/\.[^/.]+$/, ""); // 拡張子削除
            
            const fileName = `screenshot_${cleanName}_${timeStr}.png`;

            // 擬似リンクを作ってダウンロードを発火
            const a = Object.assign(document.createElement('a'), {
                href: dataURL,
                download: fileName
            });
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            console.log(`Screenshot saved successfully: ${fileName}`);
        } catch (err) {
            console.error('Screenshot failed:', err);
            alert('スクリーンショットの保存に失敗しました。');
        }

        // --- 4. 状態の復元 ---
        // シーン背景とアルファ設定を元に戻す
        scene.background = originalBackground;
        renderer.setClearAlpha(originalClearAlpha);

        // 次のマウス移動で自然に再描画されるよう、一時退避したIDをもとにハイライトを復元する準備
        // （即座に復元したい場合は、直前のマウス座標を保持して updateHighlight を叩くことも可能です）
        hoveredFaceId = null; 
    });

    // ボタンにマウスが乗ったときのビジュアルフィードバック
    screenshotButton.addEventListener('mouseenter', () => {
        screenshotButton.style.background = 'rgba(30, 41, 59, 0.95)';
        screenshotButton.style.borderColor = '#7dd3fc';
    });
    screenshotButton.addEventListener('mouseleave', () => {
        screenshotButton.style.background = 'rgba(20,20,28,0.88)';
        screenshotButton.style.borderColor = '#334';
    });
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
// Toggle Grid Command
////////////////////////////////////////////////////////////

if (toggleGridButton) {
    toggleGridButton.addEventListener('click', () => {
        showGrid = !showGrid;
        toggleGridButton.innerText = showGrid ? 'グリッド非表示' : 'グリッド表示';

        const grid = scene.getObjectByName('gridHelper');
        if (grid) {
            grid.visible = showGrid; 
        }
    });
}

////////////////////////////////////////////////////////////
// カメラ視点切り替え & センタリング
////////////////////////////////////////////////////////////

function setCameraDirection(axis, sign) {
    if (!controls) return;

    const target = controls.target.clone();
    const distance = camera.position.distanceTo(target);

    const newPos = target.clone();
    if (axis === 'x') newPos.x += distance * sign;
    if (axis === 'y') newPos.y += distance * sign;
    if (axis === 'z') newPos.z += distance * sign;

    camera.position.copy(newPos);

    if (axis === 'y') {
        camera.up.set(0, 0, sign === 1 ? -1 : 1);
    } else {
        camera.up.set(0, 1, 0); 
    }

    controls.update();
}

viewPosXBtn.addEventListener('click', () => setCameraDirection('x', 1));
viewNegXBtn.addEventListener('click', () => setCameraDirection('x', -1));
viewPosYBtn.addEventListener('click', () => setCameraDirection('y', 1));
viewNegYBtn.addEventListener('click', () => setCameraDirection('y', -1));
viewPosZBtn.addEventListener('click', () => setCameraDirection('z', 1));
viewNegZBtn.addEventListener('click', () => setCameraDirection('z', -1));

centerButton.addEventListener('click', () => {
    if (!currentModel || !controls) return;

    const box = new THREE.Box3().setFromObject(currentModel);
    const newCenter = box.getCenter(new THREE.Vector3());

    const oldCenter = controls.target.clone();
    const offset = new THREE.Vector3().subVectors(newCenter, oldCenter);

    camera.position.add(offset);
    controls.target.copy(newCenter);
    controls.update();
    
    console.log('Centered object while keeping current view angle.');
});

////////////////////////////////////////////////////////////
// Resize (OrthographicCamera用)
////////////////////////////////////////////////////////////

window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    const currentHeight = camera.top - camera.bottom;
    
    camera.left   = -currentHeight * aspect / 2;
    camera.right  =  currentHeight * aspect / 2;
    
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