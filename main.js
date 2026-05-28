////////////////////////////////////////////////////////////
// main.js  –  STEP Face Viewer (FaceID Mode)
//
//  - opencascade.js (WASM) で STEP を読み込み
//  - TopExp_Explorer (TopAbs_SOLID) でソリッドパーツ単位に分割
//  - 各パーツ内のフェイスを巡回し、頂点属性に一意な faceId を付与
//  - インデックス付き BufferGeometry で頂点を共有
//  - カメラ操作時・ドラッグ時のハイライト計算をスキップし軽量化
//  - 各パーツ・面ごとの独立したカラー保存・復元（JSON）に対応
//  - 別モデルのJSON読み込みを拒否するバリデーション機能
//  - 折りたたみ式のパーツ表示切替UI（一括操作対応）
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
const resetViewButton   = document.getElementById('resetViewButton');

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

// 動的パーツ表示切替用UI要素
const partsMenu         = document.getElementById('parts-menu');
const partsMenuHeader   = document.getElementById('parts-menu-header');
const partsContainer    = document.getElementById('partsContainer');
const btnCheckAll       = document.getElementById('btn-check-all');
const btnUncheckAll     = document.getElementById('btn-uncheck-all');


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
// Preset Colors Configuration
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

        const indicator = document.createElement('div');
        indicator.className = 'tag-color-indicator';
        indicator.style.backgroundColor = preset.hex;
        indicator.title = `パレットカラー ${index + 1}: ${preset.name} をブラシに適用`;
        indicator.addEventListener('click', () => {
            colorPicker.value = preset.hex;
            console.log('Brush color changed via tag panel:', preset.hex);
        });

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
// パーツ表示切替パネルの折りたたみ開閉設定
////////////////////////////////////////////////////////////
if (partsMenuHeader && partsMenu) {
    partsMenuHeader.addEventListener('click', () => {
        partsMenu.classList.toggle('collapsed');
    });
}


////////////////////////////////////////////////////////////
// パーツ表示一括操作（全て表示／全て非表示）
////////////////////////////////////////////////////////////
if (btnCheckAll) {
    btnCheckAll.addEventListener('click', () => {
        if (!currentModel) return;
        const checkboxes = partsContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
        
        currentModel.children.forEach((partGroup) => {
            if (partGroup.isGroup && partGroup.name.startsWith('PartGroup_Solid_')) {
                partGroup.visible = true;
            }
        });
    });
}

if (btnUncheckAll) {
    btnUncheckAll.addEventListener('click', () => {
        if (!currentModel) return;
        const checkboxes = partsContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
        
        currentModel.children.forEach((partGroup) => {
            if (partGroup.isGroup && partGroup.name.startsWith('PartGroup_Solid_')) {
                partGroup.visible = false;
            }
        });
        clearHighlight();
    });
}


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
controls.dampingFactor = 0.2; // デフォルト値。数値を大きくするとピタッと止まり、小さくすると長く滑ります。

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
let isLeftMouseDown = false;
let isRotating      = false;
let colorHistory    = [];
const MAX_HISTORY   = 20;
let showEdges       = true;
let showGrid        = true;
let hoveredFaceId   = null;   // 現在ホバーしているFaceID
let highlightGroup  = null;   // ハイライト表示用のコンテナ
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
            e.target.value = ''; 
            return;
        }
    }
    await loadStepFile(file);
    e.target.value = ''; 
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
// STEP Loader (Solid分割・表示切替UI生成)
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

        if (partsContainer) partsContainer.innerHTML = '';

        faceGroupMap = new Map(); 
        colorHistory = [];

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

        loading.innerText = 'Tessellating shapes...';
        new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

        loading.innerText = 'Building Parts and FaceID map...';

        currentModel = new THREE.Group();
        currentModel.userData.name = file.name;

        const edgesMaterial = new THREE.LineBasicMaterial({ 
            color: 0x555555, 
            linewidth: 1     
        });

        let globalFaceId = 0;
        let totalTriangles = 0;

        // SOLID（塊）単位で探索してパーツを個別に構築
        const solidExplorer = new oc.TopExp_Explorer_1();
        solidExplorer.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

        let solidId = 0;

        while (solidExplorer.More()) {
            const solid = oc.TopoDS.Solid_1(solidExplorer.Current());

            const partPositions = [];
            const partNormals   = [];
            const partIndices   = [];
            const partFaceIds   = [];

            let partVertexOffset = 0;
            let partTriCounter = 0;

            const faceExplorer = new oc.TopExp_Explorer_1();
            faceExplorer.Init(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

            while (faceExplorer.More()) {
                const face       = oc.TopoDS.Face_1(faceExplorer.Current());
                const location   = new oc.TopLoc_Location_1();
                const polyHandle = oc.BRep_Tool.Triangulation(face, location);

                if (polyHandle.IsNull()) {
                    faceExplorer.Next();
                    globalFaceId++;
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
                    partPositions.push(x, y, z);
                    partFaceIds.push(globalFaceId);

                    if (hasNormals) {
                        const n = tris.Normal(v);
                        partNormals.push(n.X() * sign, n.Y() * sign, n.Z() * sign);
                    } else {
                        partNormals.push(0, 1, 0);
                    }
                }

                const triGroup = [];
                for (let t = 1; t <= nTris; t++) {
                    const tri = tris.Triangle(t);
                    const i1  = tri.Value(1) - 1 + partVertexOffset;
                    const i2  = tri.Value(2) - 1 + partVertexOffset;
                    const i3  = tri.Value(3) - 1 + partVertexOffset;

                    if (isReversed) {
                        partIndices.push(i1, i3, i2);
                    } else {
                        partIndices.push(i1, i2, i3);
                    }

                    triGroup.push(partTriCounter++);
                    totalTriangles++;
                }

                faceGroupMap.set(globalFaceId, triGroup);

                partVertexOffset += nNodes;
                globalFaceId++;
                faceExplorer.Next();
            }

            if (partPositions.length > 0) {
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(partPositions, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(partNormals, 3));
                
                const faceIdArray = new Float32Array(partFaceIds);
                geometry.setAttribute('faceId', new THREE.BufferAttribute(faceIdArray, 1));
                geometry.setIndex(partIndices);

                const hasZeroNormal = partNormals.some((v, i) =>
                    i % 3 === 1 && partNormals[i-1] === 0 && v === 1 && partNormals[i+1] === 0
                );
                if (hasZeroNormal) {
                    geometry.computeVertexNormals();
                }

                const vertexCount = partPositions.length / 3;
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
                mesh.name = `Solid_Part_${solidId}`;
                mesh.castShadow = true;
                mesh.receiveShadow = true;

                const edgesGeometry = new THREE.EdgesGeometry(geometry, 24);
                const edgeLines = new THREE.LineSegments(edgesGeometry, edgesMaterial);
                edgeLines.name = 'edgeLines';
                edgeLines.visible = showEdges;

                const partGroup = new THREE.Group();
                partGroup.name = `PartGroup_Solid_${solidId}`;
                partGroup.add(mesh);
                partGroup.add(edgeLines);

                currentModel.add(partGroup);
                solidId++;
            }

            solidExplorer.Next();
        }

// パーツ表示切替用チェックボックスの動的生成（mouseenter部分をアップデート）
        if (partsContainer) {
            partsContainer.innerHTML = '';
            
            currentModel.children.forEach((partGroup) => {
                if (partGroup.isGroup && partGroup.name.startsWith('PartGroup_Solid_')) {
                    const solidIdx = partGroup.name.replace('PartGroup_Solid_', '');
                    const partLabelText = `パーツ ${Number(solidIdx) + 1}`;

                    const label = document.createElement('label');
                    label.className = 'part-check-label';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = true;

                    // チェックボックスの変更イベント
                    checkbox.addEventListener('change', (e) => {
                        partGroup.visible = e.target.checked;
                        if (!e.target.checked) {
                            clearHighlight();
                        }
                    });

                    // ★【修正】文字列（ラベル）にマウスオーバーしたときの連動ハイライト
                    label.addEventListener('mouseenter', () => {
                        // 3D側のマウスオーバーと競合しないよう一旦クリア
                        clearHighlight();

                        // 選択されたパーツのMeshを取得
                        const mesh = partGroup.children.find(child => child.isMesh);
                        if (!mesh) return;

                        // ★パーツ本体が非表示(checkboxがOFF)であっても、
                        // ジオメトリを複製して独立したハイライト用メッシュをシーンに強制追加する
                        const highlightGeom = mesh.geometry.clone();
                        
                        highlightGroup = new THREE.Group();
                        highlightGroup.name = 'dynamicHighlightGroup';

                        // 非表示パーツと判別しやすいよう、少し透過度を調整（0.35）
                        const faceMat = new THREE.MeshBasicMaterial({
                            color: 0xff0000,
                            transparent: true,
                            opacity: 0.35, 
                            side: THREE.DoubleSide,
                            depthTest: true,
                            depthWrite: false
                        });
                        const highlightMesh = new THREE.Mesh(highlightGeom, faceMat);
                        highlightGroup.add(highlightMesh);

                        const edgesGeom = new THREE.EdgesGeometry(highlightGeom, 24);
                        const edgesMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 1, depthTest: true });
                        const highlightEdgeMesh = new THREE.LineSegments(edgesGeom, edgesMat);
                        highlightGroup.add(highlightEdgeMesh);

                        // 位置や回転の同期
                        highlightGroup.position.copy(mesh.position);
                        highlightGroup.rotation.copy(mesh.rotation);
                        highlightGroup.scale.copy(mesh.scale);
                        highlightGroup.scale.multiplyScalar(1.0005); // チラつき（Z-fighting）防止

                        scene.add(highlightGroup);
                    });

                    // マウスが離れたらハイライトを消去
                    label.addEventListener('mouseleave', () => {
                        clearHighlight();
                    });

                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode(partLabelText));
                    partsContainer.appendChild(label);
                }
            });
        }

        scene.add(currentModel);
        triCountLabel.innerText = totalTriangles.toLocaleString();

        triggerAutoFit();
        loading.style.display = 'none';
        console.log(`STEP loaded by Solid: ${solidId} genuine parts found, ${globalFaceId} total faces.`);

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

    // 非表示状態のパーツはペイント対象から除外
    if (intersect.object.parent && intersect.object.parent.visible === false) return;

    const hitTriangle = intersect.faceIndex;
    if (hitTriangle === undefined) return;

    const targetMesh = intersect.object;
    const geometry   = targetMesh.geometry;
    const indexAttr  = geometry.index;
    const faceIdAttr = geometry.attributes.faceId;

    if (!indexAttr || !faceIdAttr) return;

    const vertexIndex = indexAttr.getX(hitTriangle * 3);
    const faceIdVal   = Math.round(faceIdAttr.getX(vertexIndex));

    faceIdLabel.innerText   = faceIdVal;
    meshNameLabel.innerText = `Face_${faceIdVal}`;

    const paintModeElement = document.querySelector('input[name="paintMode"]:checked');
    const paintMode = paintModeElement ? paintModeElement.value : 'face';

    if (isFirstClick) saveHistory(targetMesh);

    if (paintMode === 'part') {
        applyColorToPart(targetMesh, colorPicker.value);
    } else {
        applyColorToFaceIdInMesh(targetMesh, faceIdVal, colorPicker.value);
    }
}

// パーツ全体（メッシュ全体）に頂点カラーを適用
function applyColorToPart(mesh, hexColor) {
    const geometry = mesh.geometry;
    const colorAttr = geometry.attributes.color;
    if (!colorAttr) return;

    const color = new THREE.Color(hexColor);
    const count = colorAttr.count;

    for (let i = 0; i < count; i++) {
        colorAttr.setXYZ(i, color.r, color.g, color.b);
    }
    colorAttr.needsUpdate = true;
}

// メッシュ内の特定の FaceID を持つ頂点だけを塗りつぶす
function applyColorToFaceIdInMesh(mesh, targetFaceId, hexColor) {
    const geometry = mesh.geometry;
    const colorAttr = geometry.attributes.color;
    const faceIdAttr = geometry.attributes.faceId;
    if (!colorAttr || !faceIdAttr) return;

    const color = new THREE.Color(hexColor);
    const count = colorAttr.count;

    for (let i = 0; i < count; i++) {
        if (Math.round(faceIdAttr.getX(i)) === targetFaceId) {
            colorAttr.setXYZ(i, color.r, color.g, color.b);
        }
    }
    colorAttr.needsUpdate = true;
}


////////////////////////////////////////////////////////////
// マウスオーバー時のハイライト処理 (カメラ操作時スキップ対応)
////////////////////////////////////////////////////////////

function updateHighlight(clientX, clientY) {
    if (!currentModel) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    camera.updateProjectionMatrix();
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObjects(currentModel.children, true);
    const intersect = intersects.find(hit => hit.object.isMesh);
    
    if (!intersect || (intersect.object.parent && intersect.object.parent.visible === false)) {
        clearHighlight();
        return;
    }

    const hitTriangle = intersect.faceIndex;
    if (hitTriangle === undefined) return;

    const targetMesh = intersect.object;
    const geometry   = targetMesh.geometry;
    const indexAttr  = geometry.index;
    const faceIdAttr = geometry.attributes.faceId;

    if (!indexAttr || !faceIdAttr) return;

    const vertexIndex = indexAttr.getX(hitTriangle * 3);
    const faceIdVal   = Math.round(faceIdAttr.getX(vertexIndex));

    if (hoveredFaceId === faceIdVal) return;
    hoveredFaceId = faceIdVal;

    clearHighlight();

    const paintModeElement = document.querySelector('input[name="paintMode"]:checked');
    const paintMode = paintModeElement ? paintModeElement.value : 'face';

    let highlightGeom = new THREE.BufferGeometry();

    if (paintMode === 'part') {
        highlightGeom = geometry.clone();
    } else {
        const posAttr = geometry.attributes.position;
        const localPositions = [];
        const localIndices = [];
        const vertexMap = new Map();
        let localVertexCounter = 0;

        const count = indexAttr.count;
        for (let i = 0; i < count; i += 3) {
            const i0 = indexAttr.getX(i);
            const i1 = indexAttr.getX(i + 1);
            const i2 = indexAttr.getX(i + 2);

            const fId = Math.round(faceIdAttr.getX(i0));
            if (fId === faceIdVal) {
                const gIdxs = [i0, i1, i2];
                for (const gIdx of gIdxs) {
                    if (!vertexMap.has(gIdx)) {
                        vertexMap.set(gIdx, localVertexCounter);
                        localPositions.push(posAttr.getX(gIdx), posAttr.getY(gIdx), posAttr.getZ(gIdx));
                        localVertexCounter++;
                    }
                    localIndices.push(vertexMap.get(gIdx));
                }
            }
        }

        if (localPositions.length === 0) return;
        highlightGeom.setAttribute('position', new THREE.Float32BufferAttribute(localPositions, 3));
        highlightGeom.setIndex(localIndices);
    }
    
    highlightGroup = new THREE.Group();
    highlightGroup.name = 'dynamicHighlightGroup';

    const faceMat = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.25,        
        side: THREE.DoubleSide, 
        depthTest: true,
        depthWrite: false     
    });
    const highlightMesh = new THREE.Mesh(highlightGeom, faceMat);
    highlightGroup.add(highlightMesh);

    const edgesGeom = new THREE.EdgesGeometry(highlightGeom, 24);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 1, depthTest: true });
    const highlightEdgeMesh = new THREE.LineSegments(edgesGeom, edgesMat);
    highlightGroup.add(highlightEdgeMesh);

    highlightGroup.position.copy(targetMesh.position);
    highlightGroup.rotation.copy(targetMesh.rotation);
    highlightGroup.scale.copy(targetMesh.scale);
    
    highlightGroup.scale.multiplyScalar(1.0005); 

    scene.add(highlightGroup);
}

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
        clearHighlight();
        return;
    }

    // カメラ操作中（回転・パン・ズーム）やドラッグ中は重い計算をスキップして高速化
    if (isRotating || isLeftMouseDown) {
        clearHighlight();
        return;
    }

    updateHighlight(e.clientX, e.clientY);
});

const stopPainting = () => {
    isLeftMouseDown  = false;
    isRotating       = false;
    controls.enabled = true;
    clearHighlight(); 
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
    const attr = mesh?.geometry?.attributes?.color;
    if (!attr || !attr.array) return;
    colorHistory.push(attr.array.slice());
    if (colorHistory.length > MAX_HISTORY) colorHistory.shift();
}

undoButton.addEventListener('click', () => {
    if (!colorHistory.length || !currentModel) return;
    
    currentModel.traverse((child) => {
        if (child.isMesh && colorHistory.length > 0) {
            const attr = child.geometry.attributes.color;
            if (attr) {
                attr.array.set(colorHistory.pop());
                attr.needsUpdate = true;
            }
        }
    });
});


////////////////////////////////////////////////////////////
// Grid
////////////////////////////////////////////////////////////

const gridHelper = new THREE.GridHelper(500, 50, 0x444444, 0x2a2a2a);
gridHelper.name = 'gridHelper'; 
scene.add(gridHelper);


////////////////////////////////////////////////////////////
// Save / Load Color JSON (バリデーションチェック機能付き)
////////////////////////////////////////////////////////////

saveColorsButton.addEventListener('click', () => {
    if (!currentModel) { alert('モデルが読み込まれていません。'); return; }

    const faceColorMap = {};
    let totalVerticesProcessed = 0;

    currentModel.traverse((child) => {
        if (child.isMesh) {
            const geometry = child.geometry;
            const colorAttr = geometry?.attributes?.color;
            const faceIdAttr = geometry?.attributes?.faceId;

            if (colorAttr && faceIdAttr) {
                const vertexCount = colorAttr.count;

                for (let i = 0; i < vertexCount; i++) {
                    const fId = Math.round(faceIdAttr.getX(i));
                    if (faceColorMap[fId] !== undefined) continue;

                    const r = colorAttr.getX(i);
                    const g = colorAttr.getY(i);
                    const b = colorAttr.getZ(i);
                    const color = new THREE.Color(r, g, b);
                    faceColorMap[fId] = "#" + color.getHexString();
                }
                totalVerticesProcessed += vertexCount;
            }
        }
    });

    if (Object.keys(faceColorMap).length === 0) {
        alert('カラーデータまたはFaceIDデータが見つかりませんでした。');
        return;
    }

    const tagsData = presetColors.map((_, index) => {
        const inputEl = document.getElementById(`tag-input-${index}`);
        return inputEl ? inputEl.value : '';
    });

    const modelName = currentModel.userData.name || "model.step";
    const exportData = {
        application: "STEP Face Viewer – FaceID Mode",
        timestamp: Date.now(),
        fileName: modelName,
        faceColors: faceColorMap, 
        tags: tagsData
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'step-colors.json',
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    
    console.log(`Color mapping saved successfully. Map size: ${Object.keys(faceColorMap).length}`);
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

            if (!data.faceColors) {
                alert('互換性のない形式のJSONファイルです（faceColorsが含まれていません）。');
                return;
            }

            // 【バリデーションチェック】Face数が異なる別モデルからの読み込みを拒否
            const currentTotalFaces = faceGroupMap.size;
            const jsonTotalFaces = Object.keys(data.faceColors).length;

            if (currentTotalFaces !== jsonTotalFaces) {
                alert(`❌ 異なるモデルのカラーデータです。\n\n現在のモデルのFace数: ${currentTotalFaces}\nJSONのFace数: ${jsonTotalFaces}\n\n読み込みを中止しました。`);
                e.target.value = '';
                return; 
            }

            currentModel.traverse((child) => {
                if (child.isMesh) saveHistory(child);
            });

            const tempColor = new THREE.Color();
            let appliedCount = 0;

            currentModel.traverse((child) => {
                if (child.isMesh) {
                    const geometry = child.geometry;
                    const colorAttr = geometry?.attributes?.color;
                    const faceIdAttr = geometry?.attributes?.faceId;

                    if (colorAttr && faceIdAttr) {
                        const vertexCount = colorAttr.count;
                        for (let i = 0; i < vertexCount; i++) {
                            const fId = Math.round(faceIdAttr.getX(i));
                            const targetHex = data.faceColors[fId];

                            if (targetHex !== undefined) {
                                tempColor.set(targetHex);
                                colorAttr.setXYZ(i, tempColor.r, tempColor.g, tempColor.b);
                                appliedCount++;
                            }
                        }
                        colorAttr.needsUpdate = true;
                    }
                }
            });

            if (data.tags && Array.isArray(data.tags)) {
                data.tags.forEach((tagText, index) => {
                    const inputEl = document.getElementById(`tag-input-${index}`);
                    if (inputEl) inputEl.value = tagText || '';
                });
            }

            alert('FaceIDマッピングに基づき、カラーデータを復元しました。');
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

function triggerAutoFit() {
    if (!currentModel) return;
    
    const box = new THREE.Box3().setFromObject(currentModel);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    camera.up.set(0, 1, 0);
    controls.target.copy(center);

    const initDir = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(center).addScaledVector(initDir, maxDim * 10);

    camera.zoom = 1;

    const aspect = window.innerWidth / window.innerHeight;
    camera.left   = -aspect / 2;
    camera.right  =  aspect / 2;
    camera.top    =  1 / 2;
    camera.bottom = -1 / 2;

    let requiredCalculatedSize = maxDim;
    if (aspect < 1) {
        requiredCalculatedSize = maxDim / aspect;
    }
    const margin = 1.2; 
    camera.zoom = 1 / (requiredCalculatedSize * margin);

    camera.near = 0.1;
    camera.far  = maxDim * 100; 
    
    camera.updateProjectionMatrix();
    controls.update();
    controls.saveState(); 
}

resetViewButton.addEventListener('click', () => {
    triggerAutoFit();
    console.log('View reset: Direction and camera.zoom re-fitted perfectly.');
});


////////////////////////////////////////////////////////////
// スクリーンショット機能
////////////////////////////////////////////////////////////

const screenshotButton = document.getElementById('mode-badge');

if (screenshotButton) {
    screenshotButton.addEventListener('click', () => {
        if (!currentModel) {
            alert('モデルが読み込まれていません。');
            return;
        }

        clearHighlight();

        const originalBackground = scene.background;
        scene.background = null;

        const originalClearAlpha = renderer.getClearAlpha();
        renderer.setClearAlpha(0);

        renderer.render(scene, camera);

        try {
            const dataURL = canvas.toDataURL('image/png');
            const now = new Date();
            const timeStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const modelName = currentModel.userData.name || "model";
            const cleanName = modelName.replace(/\.[^/.]+$/, ""); 
            
            const fileName = `screenshot_${cleanName}_${timeStr}.png`;

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

        scene.background = originalBackground;
        renderer.setClearAlpha(originalClearAlpha);
    });

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

        currentModel.traverse((child) => {
            if (child.name === 'edgeLines') {
                child.visible = showEdges;
            }
        });
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
