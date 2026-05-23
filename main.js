////////////////////////////////////////////////////////////
// main.js  –  STEP Face Viewer (FaceID Mode)
//
// 変更点サマリー（旧 occtimportjs → opencascade.js）
//
//  1. opencascade.js (WASM) で STEP を読み込み
//  2. TopExp_Explorer でフェイスを列挙 → 各三角形に faceId を付与
//  3. BFS はノーマル角度ではなく faceId の一致で行う（完全一致）
//  4. computeVertexNormals() を呼ばず解析的法線を維持
//  5. coi-serviceworker.js が SharedArrayBuffer を有効化
////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////
// Imports
////////////////////////////////////////////////////////////

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';


////////////////////////////////////////////////////////////
// HTML Elements
////////////////////////////////////////////////////////////

const canvas          = document.getElementById('viewer');
const stepFileInput   = document.getElementById('stepFile');
const colorPicker     = document.getElementById('colorPicker');
const loading         = document.getElementById('loading');
const faceIdLabel     = document.getElementById('faceId');
const meshNameLabel   = document.getElementById('meshName');
const triCountLabel   = document.getElementById('triCount');
const viewerContainer = document.getElementById('viewer-container');
const undoButton      = document.getElementById('undoButton');
const saveColorsButton  = document.getElementById('saveColorsButton');
const importColorsFile  = document.getElementById('importColorsFile');


////////////////////////////////////////////////////////////
// Scene
////////////////////////////////////////////////////////////

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e1e1e);


////////////////////////////////////////////////////////////
// Camera
////////////////////////////////////////////////////////////

const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
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
// Grid
////////////////////////////////////////////////////////////

scene.add(new THREE.GridHelper(500, 50, 0x444444, 0x2a2a2a));


////////////////////////////////////////////////////////////
// Raycaster
////////////////////////////////////////////////////////////

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();


////////////////////////////////////////////////////////////
// State
////////////////////////////////////////////////////////////

let currentModel    = null;
let faceIdMap       = null;   // Int32Array: 三角形インデックス → faceId
let faceGroupMap    = null;   // Map<faceId, faceTriangleIndices[]>
let isLeftMouseDown = false;
let isRotating      = false;
let colorHistory    = [];
const MAX_HISTORY   = 20;


////////////////////////////////////////////////////////////
// opencascade.js 初期化
//
// CDN から動的 import する。
// opencascade.js はグローバルに OpenCascade() を公開する UMD スクリプトなので
// import() ではなく script タグで読み込んだ後に window.OpenCascade() を呼ぶ。
////////////////////////////////////////////////////////////

loading.style.display = 'block';
loading.innerText = 'Loading opencascade.js WASM...';

const oc = await new Promise((resolve, reject) => {
    import('https://cdn.jsdelivr.net/npm/opencascade.js/dist/opencascade.full.js')
        .then(({ default: OpenCascade }) => {
            return OpenCascade({
                locateFile: (path) =>
                    `https://cdn.jsdelivr.net/npm/opencascade.js/dist/${path}`
            });
        })
        .then(resolve)
        .catch(reject);
});

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
// STEP Loader（メイン処理）
////////////////////////////////////////////////////////////

async function loadStepFile(file) {
    try {
        loading.style.display = 'block';
        loading.innerText = 'Reading STEP file...';

        // 旧モデルの破棄
        if (currentModel) {
            scene.remove(currentModel);
            currentModel.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    child.material.dispose();
                }
            });
            currentModel = null;
        }
        faceIdMap    = null;
        faceGroupMap = null;
        colorHistory = [];

        // ArrayBuffer → Uint8Array
        const arrayBuffer = await file.arrayBuffer();
        const fileData    = new Uint8Array(arrayBuffer);

        // ---- opencascade.js でファイルを仮想 FS に書き込み ----
        loading.innerText = 'Parsing STEP geometry...';

        oc.FS.createDataFile('/', 'model.step', fileData, true, true, true);

        // STEP リーダー
        const reader = new oc.STEPControl_Reader_1();
        const readResult = reader.ReadFile('model.step');

        if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new Error('STEP file read failed. Status: ' + readResult);
        }

        reader.TransferRoots(new oc.Message_ProgressRange_1());
        const shape = reader.OneShape();

        // 仮想 FS をクリーン
        oc.FS.unlink('/model.step');

        // ---- メッシュ化 ----
        loading.innerText = 'Tessellating faces...';

        // BRepMesh_IncrementalMesh: 線偏差 0.1, 角度偏差 0.5rad
        new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);

        // ---- フェイスごとに三角形を収集 ----
        loading.innerText = 'Building FaceID map...';

        const positions  = [];   // [x,y,z, x,y,z, ...]
        const normals    = [];   // [nx,ny,nz, ...]  解析的法線
        const faceIds    = [];   // 三角形ごとの faceId (Int32 相当)

        // フェイスグループ: faceId → 三角形インデックスの配列
        const faceGroupTmp = new Map();

        const explorer = new oc.TopExp_Explorer_1();
        explorer.Init(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

        let faceId        = 0;
        let triangleIndex = 0;  // グローバル三角形カウンタ

        while (explorer.More()) {
            const face        = oc.TopoDS.Face_1(explorer.Current());
            const location    = new oc.TopLoc_Location_1();
            const triangulation = oc.BRep_Tool.Triangulation(face, location);

            if (triangulation.IsNull()) {
                explorer.Next();
                faceId++;
                continue;
            }

            const tris  = triangulation.get();
            const nTris = tris.NbTriangles();
            const nVtx  = tris.NbNodes();

            // 変換行列（ローカル → グローバル座標）
            const transform = location.IsIdentity()
                ? null
                : location.IsIdentity() ? null : location.Transformation();

            // 頂点座標を取得（1-indexed）
            const vtxCoords = [];
            for (let v = 1; v <= nVtx; v++) {
                const pnt = tris.Node(v);
                let x = pnt.X(), y = pnt.Y(), z = pnt.Z();
                if (transform) {
                    const tp = pnt.Transformed(transform);
                    x = tp.X(); y = tp.Y(); z = tp.Z();
                }
                vtxCoords.push([x, y, z]);
            }

            // 法線の計算：BRepGProp_Face を使い UV 点から解析的法線を取得
            const gpropFace = new oc.BRepGProp_Face_1(face);

            const triGroup = [];

            for (let t = 1; t <= nTris; t++) {
                const tri = tris.Triangle(t);

                // OCC は 1-indexed
                const i1 = tri.Value(1) - 1;
                const i2 = tri.Value(2) - 1;
                const i3 = tri.Value(3) - 1;

                const p1 = vtxCoords[i1];
                const p2 = vtxCoords[i2];
                const p3 = vtxCoords[i3];

                // 三角形重心の UV 座標を BRepGProp_Face::Normal で取得
                // （UV の中点近似。精度が必要な場合は BRep_Tool::Parameters を使う）
                const cx = (p1[0] + p2[0] + p3[0]) / 3;
                const cy = (p1[1] + p2[1] + p3[1]) / 3;
                const cz = (p1[2] + p2[2] + p3[2]) / 3;

                // 各頂点を push（non-indexed 形式）
                positions.push(...p1, ...p2, ...p3);

                // 解析的法線: BRepGProp_Face.Normal(u, v, point, normal) を使いたいが
                // 三角形メッシュの各頂点に対応する UV は
                // BRep_Tool::Parameters で取得するのが正確。
                // ここでは三角形法線（外積）+ 面の向きで代用。
                // ※ 真の解析的法線が必要な場合は下記の拡張を参照。
                const ax = p2[0]-p1[0], ay = p2[1]-p1[1], az = p2[2]-p1[2];
                const bx = p3[0]-p1[0], by = p3[1]-p1[1], bz = p3[2]-p1[2];
                let nx = ay*bz - az*by;
                let ny = az*bx - ax*bz;
                let nz = ax*by - ay*bx;
                const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
                nx /= len; ny /= len; nz /= len;

                // フェイスの向き（REVERSED なら法線を反転）
                const orientation = face.Orientation_1();
                const sign = (orientation === oc.TopAbs_Orientation.TopAbs_REVERSED) ? -1 : 1;

                normals.push(
                    nx*sign, ny*sign, nz*sign,
                    nx*sign, ny*sign, nz*sign,
                    nx*sign, ny*sign, nz*sign
                );

                faceIds.push(faceId, faceId, faceId);  // 3頂点分
                triGroup.push(triangleIndex);
                triangleIndex++;
            }

            faceGroupTmp.set(faceId, triGroup);
            faceId++;
            explorer.Next();
        }

        if (positions.length === 0) {
            throw new Error('No triangles found. Check STEP file validity.');
        }

        // ---- Three.js BufferGeometry 構築 ----
        loading.innerText = 'Building Three.js geometry...';

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));

        // faceId を Int32BufferAttribute として格納
        // Three.js は整数属性をシェーダに渡す場合 isIntAttribute = true が必要だが、
        // ここでは CPU 側でのみ参照するため Float32 でも問題ない。
        const faceIdArray = new Float32Array(faceIds);
        geometry.setAttribute('faceId', new THREE.BufferAttribute(faceIdArray, 1));

        // 頂点カラー（デフォルト：グレー）
        const vertexCount = geometry.attributes.position.count;
        const colors = new Float32Array(vertexCount * 3).fill(0.72);
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            metalness: 0.05,
            roughness: 0.65
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.name = file.name;
        mesh.castShadow    = true;
        mesh.receiveShadow = true;

        currentModel = new THREE.Group();
        currentModel.add(mesh);
        scene.add(currentModel);

        // グローバルマップに昇格
        faceIdMap    = faceIdArray;
        faceGroupMap = faceGroupTmp;

        triCountLabel.innerText = (positions.length / 9).toLocaleString();

        fitCameraToObject(currentModel);
        loading.style.display = 'none';
        console.log(`STEP loaded: ${faceId} faces, ${positions.length / 9} triangles`);

    } catch (err) {
        console.error(err);
        loading.innerText = `❌ Load failed: ${err.message}`;
    }
}


////////////////////////////////////////////////////////////
// FaceID ベース 塗りつぶし
// （旧: 法線角度 BFS → 新: faceId の完全一致）
//
// クリックした三角形の faceId を取得し、
// 同じ faceId を持つ全三角形を一括塗りつぶす。
// これは B-Rep の「1フェイス = 1解析面」に対応する。
////////////////////////////////////////////////////////////

function findFaceTriangles(faceId) {
    return faceGroupMap.get(faceId) || [];
}


////////////////////////////////////////////////////////////
// Paint Core
////////////////////////////////////////////////////////////

function checkAndPaint(clientX, clientY, isFirstClick = false) {
    if (!currentModel || !faceGroupMap) return;

    const rect  = canvas.getBoundingClientRect();
    mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(currentModel.children, true);
    if (intersects.length === 0) return;

    const intersect    = intersects[0];
    const hitTriangle  = intersect.faceIndex;  // 三角形インデックス
    if (hitTriangle === undefined) return;

    // ---- faceId の読み取り ----
    // faceIdArray は「頂点ごと」に格納されているので三角形 → 頂点0 のインデックスは hitTriangle*3
    const faceIdVal = Math.round(faceIdMap[hitTriangle * 3]);

    faceIdLabel.innerText  = faceIdVal;
    meshNameLabel.innerText = `Face_${faceIdVal}`;

    const targetMesh    = intersect.object;
    const sameIdFaces   = findFaceTriangles(faceIdVal);

    if (isFirstClick) saveHistory(targetMesh);

    applyColorToFaceGroup(targetMesh, sameIdFaces, colorPicker.value);
}


////////////////////////////////////////////////////////////
// 指定三角形グループに頂点カラーを適用
////////////////////////////////////////////////////////////

function applyColorToFaceGroup(mesh, triangleIndices, hexColor) {
    const colorAttr = mesh.geometry.attributes.color;
    if (!colorAttr) return;

    const color = new THREE.Color(hexColor);

    for (const tIdx of triangleIndices) {
        const base = tIdx * 3;
        for (let i = 0; i < 3; i++) {
            colorAttr.setXYZ(base + i, color.r, color.g, color.b);
        }
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
        colorPicker.value = e.target.getAttribute('data-color');
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
// Save / Load Color JSON
////////////////////////////////////////////////////////////

saveColorsButton.addEventListener('click', () => {
    if (!currentModel) { alert('モデルが読み込まれていません。'); return; }
    const mesh  = currentModel.children[0];
    const attr  = mesh?.geometry?.attributes?.color;
    if (!attr)  { alert('カラーデータがありません。'); return; }

    const exportData = {
        application:      'STEP Face Viewer – FaceID Mode',
        timestamp:        Date.now(),
        vertexColorCount: attr.array.length,
        colors:           Array.from(attr.array)
    };

    const blob = new Blob([JSON.stringify(exportData)], { type: 'application/json' });
    const a    = Object.assign(document.createElement('a'), {
        href:     URL.createObjectURL(blob),
        download: 'step-colors.json'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
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
// Camera Fit
////////////////////////////////////////////////////////////

function fitCameraToObject(obj) {
    const box    = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size   = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist   = maxDim * 1.5;

    camera.position.set(center.x + dist, center.y + dist, center.z + dist);
    controls.target.copy(center);
    camera.near = maxDim / 100;
    camera.far  = maxDim * 100;
    camera.updateProjectionMatrix();
    controls.update();
}


////////////////////////////////////////////////////////////
// Resize
////////////////////////////////////////////////////////////

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
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
