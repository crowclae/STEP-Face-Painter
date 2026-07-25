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
//  - [追加] 距離測定（最短＋XYZ軸距離）＆測定時のペイント一時停止ガード
//  - [追加] 3軸・角度・距離対応の高機能メイン画面連携断面切断表示
////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////
// Imports (★インポートマップ経由でローカルを参照)
////////////////////////////////////////////////////////////

import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';


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

// ==========================================
// 🚀 新設：ランチャー・ツール機能用 UIエレメント
// ==========================================
const launcherOverlay      = document.getElementById('launcher-overlay');
const btnToolMeasure       = document.getElementById('btn-tool-measure');
const btnToolClipping      = document.getElementById('btn-tool-clipping');
const btnToolMemo          = document.getElementById('btn-tool-memo');
const memoPanel            = document.getElementById('memo-panel');
const memoTextarea         = document.getElementById('memo-textarea');
const btnCloseMemo         = document.getElementById('btn-close-memo');
const measureLabel         = document.getElementById('measure-label');
const measureText          = document.getElementById('measure-text');
const measureXyzText       = document.getElementById('measure-xyz-text');

// 👑 新設：メイン画面断面コントロールパネル
const mainClippingPanel    = document.getElementById('main-clipping-panel');
const clipAxisX            = document.getElementById('clip-axis-x');
const clipAxisY            = document.getElementById('clip-axis-y');
const clipAxisZ            = document.getElementById('clip-axis-z');
const clipSliderDist       = document.getElementById('clip-slider-dist');
const clipSliderAngle      = document.getElementById('clip-slider-angle');
const clipDistVal          = document.getElementById('clip-dist-val');
const clipAngleVal         = document.getElementById('clip-angle-val');
const clipResetBtn         = document.getElementById('clip-reset-btn');


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
    if (!tagFieldsContainer) return;
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

// 👑 ローカルクリッピングの有効化
renderer.localClippingEnabled = true;


////////////////////////////////////////////////////////////
// Controls
////////////////////////////////////////////////////////////

const controls = new TrackballControls(camera, renderer.domElement);
// staticMoving = true にすることで慣性(遅延)を無くし、マウスの動きに1:1で追従させる
// (false のままだと dynamicDampingFactor による「滑る」演出が入り、動きが遅れて感じられる)
controls.staticMoving = true;
controls.noRotate = false;
controls.noZoom   = false;
controls.noPan = true;
// マウス割り当て：左＝色付け専用（カメラ操作なし） / 右＝パン / Shift+右＝回転 / 中＝ズーム
// 左ボタン(0)はどの用途にも割り当てず(-1)、常にペイント専用にする
controls.mouseButtons = {
    LEFT: -1,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: -1
};
////////////////////////////////////////////////////////////
// Custom Pan (CADライク)
////////////////////////////////////////////////////////////

let isPanning = false;
const lastPanPos = new THREE.Vector2();

window.addEventListener('pointerdown', (e) => {

    // Shift+右はTrackballControlsの回転
    if (e.target !== canvas) return;

    if (e.button === 2 && !e.shiftKey) {

        isPanning = true;
        lastPanPos.set(e.clientX, e.clientY);

        // TrackballControlsへイベントを渡さない
        e.preventDefault();
        e.stopPropagation();
    }

}, true);


window.addEventListener('pointermove', (e) => {

    if (!isPanning) return;

    const dx = e.clientX - lastPanPos.x;
    const dy = e.clientY - lastPanPos.y;

    lastPanPos.set(e.clientX, e.clientY);

    // OrthographicCameraではズーム値のみ考慮
    const worldPerPixel =
        (camera.top - camera.bottom) /
        camera.zoom /
        renderer.domElement.clientHeight;

    const right = new THREE.Vector3();
    const up = camera.up.clone().normalize();
    const forward = new THREE.Vector3();

    camera.getWorldDirection(forward);

    right.crossVectors(forward, up).normalize();

    const move = new THREE.Vector3();

    move.addScaledVector(right, -dx * worldPerPixel);
    move.addScaledVector(up, dy * worldPerPixel);

    camera.position.add(move);
    controls.target.add(move);

    controls.update();

}, true);


window.addEventListener('pointerup', () => {
    isPanning = false;
});
// Shift+右クリックのときだけ「回転」に切り替える。
// TrackballControls内部は button番号とmouseButtons.LEFT/MIDDLE/RIGHTの値が一致した方を
// ROTATE/ZOOM/PANに割り当てる仕組みなので、Shiftが押されていれば右ボタン(2)の値を
// 一時的にLEFT側へ入れてROTATE扱いにする（LEFT側の判定が switch 内で先に評価されるため）。
// window側でcapture:trueにより、TrackballControls自身のpointerdown処理より必ず先に実行される。
window.addEventListener('pointerdown', (e) => {
    if (e.target === canvas && e.button === 2) {
        controls.mouseButtons.LEFT = e.shiftKey ? THREE.MOUSE.RIGHT : -1;
    }
}, { capture: true });

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
raycaster.params.Line = { threshold: 2.0 }; // edgeLines選択用。モデル読込後に動的調整される



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
if (colorPicker) colorPicker.value = '#e74c3c';
let isPaintingSession = false;
let paintChangedThisSession = false;

// 🚀 拡張機能用の内部ステート
let isLauncherOpen = false;
let isMeasureMode = false;
let isClippingMode = false;

let measurePoints = [];
let measureVisualLine = null;
let measureMarkers = [];

// エッジホバーハイライト用ステート（測定モード・edgeモード専用）
let hoveredEdgeHighlight = null;  // scene に追加済みの LineSegments オブジェクト
let hoveredEdgeId = -1;           // 前回ホバーした B-Rep エッジID（変化がなければスキップ）
let globalEdgeSet   = new Set(); 
let globalEdgeId    = 0;


let currentClipAxis = 'X';
const localPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);

// 既存の measure 関連ステートの近くに追加
const selectionModePanel = document.getElementById('selection-mode-panel');

// 測定モード切り替え時にUIを連動させる処理 (既存の btnToolMeasure イベントやモード切り替え箇所を修正)
// 例: モード切り替え関数内、またはトグル処理内に以下を組み込みます
let toggleMeasureMode = function (active) {
    isMeasureMode = active;
    if (selectionModePanel) {
        selectionModePanel.style.display = isMeasureMode ? 'flex' : 'none';
    }
    if (!isMeasureMode) {
        clearMeasure();
    }
}


////////////////////////////////////////////////////////////
// opencascade.js 初期化 (分割WASMの結合読み込み)
////////////////////////////////////////////////////////////

loading.style.display = 'block';
loading.innerText = 'Downloading WASM parts...';

// 分割されたファイルのパスを指定
const wasmParts = [
    './libs/opencascade/opencascade.full.wasm.part1',
    './libs/opencascade/opencascade.full.wasm.part2'
];

/**
 * 分割されたWASMファイルを並行ダウンロードして結合する関数
 */
async function loadAndCombineWasmParts(urls) {
    // 1. すべてのパーツを並行してfetch
    const arrayBuffers = await Promise.all(
        urls.map(url => fetch(url).then(res => {
            if (!res.ok) throw new Error(`Failed to fetch: ${url}`);
            return res.arrayBuffer();
        }))
    );

    // 2. 合計サイズを計算
    const totalLength = arrayBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combinedArray = new Uint8Array(totalLength);

    // 3. 1つのUint8Arrayに結合
    let offset = 0;
    for (const buffer of arrayBuffers) {
        combinedArray.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }

    // 4. Emscriptenに渡すために ArrayBuffer 形式で返す
    return combinedArray.buffer;
}

try {
    // 結合処理の実行
    const combinedBinary = await loadAndCombineWasmParts(wasmParts);
    
    loading.innerText = 'Initializing OpenCascade...';

    // locateFileの代わりに `wasmBinary` オプションを使用してバイナリを直接注入
    const oc = await import('./libs/opencascade/opencascade.full.js')
        .then(({ default: OpenCascade }) => OpenCascade({
            wasmBinary: combinedBinary
        }));

    loading.innerText = 'Drop STEP File';
    console.log('OpenCascade.js Ready via split WASM modules', oc);
    
    // 以降のロジックのためにグローバルに登録（既存コードの挙動を維持）
    window.oc = oc; 

} catch (error) {
    console.error('Failed to initialize OpenCascade:', error);
    loading.innerText = 'Error loading WASM components.';
}


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
// 進捗表示の更新ユーティリティ
////////////////////////////////////////////////////////////
async function updateProgress(text, percent = null) {
    const loadingText = document.getElementById('loading-text');
    const barContainer = document.getElementById('progress-bar-container');
    const barFill = document.getElementById('progress-bar-fill');

    if (loadingText) loadingText.innerText = text;
    
    if (percent !== null && barContainer && barFill) {
        barContainer.style.display = 'block';
        barFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    } else if (barContainer) {
        barContainer.style.display = 'none';
    }
    
    // JSのメインスレッドを一時的に解放し、ブラウザの描画（DOM更新）を強制する
    await new Promise(resolve => setTimeout(resolve, 0));
}

////////////////////////////////////////////////////////////
// STEP Loader (進捗表示・プログレスバー対応版)
////////////////////////////////////////////////////////////

async function loadStepFile(file) {
    try {
        loading.style.display = 'block';
        if (typeof globalEdgeSet !== 'undefined' && globalEdgeSet.clear) {
            globalEdgeSet.clear();
        } else {
            window.globalEdgeSet = new Set();
        }
        globalEdgeId = 0;
        await updateProgress('ファイルの読み込み中...', 5);

        clearAllMemos();

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

        if (isClippingMode) {
            isClippingMode = false;
            if (btnToolClipping) btnToolClipping.style.background = '';
            if (mainClippingPanel) mainClippingPanel.style.display = 'none';
        }
        if (isMeasureMode) {
            isMeasureMode = false;
            if (btnToolMeasure) btnToolMeasure.style.background = '';
            if (measureLabel) measureLabel.style.display = 'none';
            clearMeasure();
        }

        if (partsContainer) partsContainer.innerHTML = '';

        faceGroupMap = new Map();
        colorHistory = [];
        globalEdgeSet.clear();
        globalEdgeId = 0;

        const fileData = new Uint8Array(await file.arrayBuffer());
        oc.FS.createDataFile('/', 'model.step', fileData, true, true, true);

        await updateProgress('STEPジオメトリをパース中...', 20);

        const reader     = new oc.STEPControl_Reader_1();
        const readResult = reader.ReadFile('model.step');
        oc.FS.unlink('/model.step');

        if (readResult !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
            throw new Error('STEP read failed. Status: ' + readResult);
        }

        reader.TransferRoots(new oc.Message_ProgressRange_1());
        const rootShape = reader.OneShape();

        await updateProgress('ポリゴンメッシュを生成中 (Tessellation)...', 40);
        new oc.BRepMesh_IncrementalMesh_2(rootShape, 0.1, false, 0.5, false);

        await updateProgress('パーツ構造を解析中...', 60);

        // ════════════════════════════════════════════════════════════════
        // ★ 修正の核心: TopoDS_Iterator による再帰走査で累積Locationを取得
        //
        // STEPのアセンブリは COMPOUND/COMPSOLID の入れ子構造になっている。
        // TopExp_Explorer でいきなり SOLID を探すと、途中の親ノードが持つ
        // Location（配置変換）が「積み重ねられない」ままになる。
        //
        // TopoDS_Iterator で1段ずつ降りると、各子シェイプの Location は
        // そのノード単体の変換しか持たないが、
        //   shape.Located( parentLoc.Multiplied(shape.Location_1()) )
        // のように親のLocationと合成することで累積変換が得られる。
        //
        // この再帰を SOLID まで続けることで、アセンブリ内の全パーツの
        // 「ワールド座標系における正しいLocation」が取得できる。
        // ════════════════════════════════════════════════════════════════

        /**
         * shape のアセンブリツリーを再帰的に辿り、
         * 葉ノードの SOLID とその累積済み Location をペアで収集する。
         *
         * @param {TopoDS_Shape} shape      - 現在のシェイプ
         * @param {TopLoc_Location} parentLoc - 親から引き継いだ累積 Location
         * @param {Array} result            - { solid, loc } を積む配列
         */
        function collectSolids(shape, parentLoc, result) {
            const shapeType = shape.ShapeType();

            if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_SOLID) {
                // ★ parentLoc はすでに「祖先すべての累積 × この SOLID 自身の Location」が
                //    中間ノード側で合成済み。ここで shape.Location_1() を再取得してはいけない。
                const finalLoc = parentLoc ?? new oc.TopLoc_Location_1();
                result.push({ solid: oc.TopoDS.Solid_1(shape), loc: finalLoc });
                return;
            }

            const iter = new oc.TopoDS_Iterator_2(shape, true, true);
            while (iter.More()) {
                const child    = iter.Value();
                const childLoc = child.Location_1();

                let combinedLoc;
                if (parentLoc && !parentLoc.IsIdentity()) {
                    // ★ 修正: childLoc.Multiplied(parentLoc) が正しい合成順序
                    // OCCT の Multiplied は「自分 × 引数」なので、
                    // ワールド変換 = 親 × 子 を正しく得るには
                    // childLoc.Multiplied(parentLoc) とする必要がある
                    combinedLoc = childLoc.Multiplied(parentLoc);
                } else {
                    combinedLoc = childLoc;
                }

                collectSolids(child, combinedLoc, result);
                iter.Next();
            }
        }

        const solidEntries = []; // { solid: TopoDS_Solid, loc: TopLoc_Location }[]
        collectSolids(rootShape, null, solidEntries);
        // デバッグ: 各Solidの変換行列をコンソール出力
        solidEntries.forEach((entry, i) => {
            const trsf = entry.loc.Transformation();
            const form = trsf.Form();
            console.log(`Solid[${i}] TransformForm:`, form,
                'Mat:', [
                    trsf.Value(1,1).toFixed(3), trsf.Value(1,2).toFixed(3), trsf.Value(1,3).toFixed(3),
                    trsf.Value(2,1).toFixed(3), trsf.Value(2,2).toFixed(3), trsf.Value(2,3).toFixed(3),
                    trsf.Value(3,1).toFixed(3), trsf.Value(3,2).toFixed(3), trsf.Value(3,3).toFixed(3),
                ],
                'Trans:', [trsf.TranslationPart().X().toFixed(3), trsf.TranslationPart().Y().toFixed(3), trsf.TranslationPart().Z().toFixed(3)]
            );
        });
        const totalSolids = solidEntries.length;

        currentModel = new THREE.Group();
        currentModel.userData.name = file.name;

        const edgesMaterial = new THREE.LineBasicMaterial({
            color: 0x555555,
            linewidth: 1
        });

        let globalFaceId  = 0;
        let totalTriangles = 0;

        // ════════════════════════════════════════════════════════════════
        // 各 SOLID を累積済み Location を使って処理
        // ════════════════════════════════════════════════════════════════
        for (let solidId = 0; solidId < totalSolids; solidId++) {
            const currentPercent = 60 + Math.floor((solidId / (totalSolids || 1)) * 35);
            await updateProgress(`パーツ構築中 (${solidId + 1} / ${totalSolids})...`, currentPercent);

            const { solid, loc: assemblyLoc } = solidEntries[solidId];

            // 累積 Location から gp_Trsf を取得
            const hasSolidTrsf = assemblyLoc && !assemblyLoc.IsIdentity();
            const solidTrsf    = hasSolidTrsf ? assemblyLoc.Transformation() : null;

            // ヘルパー: 点（位置ベクトル）に累積変換を適用
            function applyAssemblyTrsf(x, y, z) {
                return [x, y, z];
            }

            // ★ 追加: 法線（方向ベクトル）に累積変換の回転部分のみ適用
            // gp_Vec.Transformed() は平行移動を無視して回転・スケールのみ適用される
            function applyAssemblyTrsfNormal(nx, ny, nz) {
                return [nx, ny, nz];
            }

            const partPositions = [];
            const partNormals   = [];
            const partIndices   = [];
            const partFaceIds   = [];
            let partVertexOffset = 0;
            let partTriCounter   = 0;

            const faceExplorer = new oc.TopExp_Explorer_1();
            faceExplorer.Init(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

            while (faceExplorer.More()) {
                const face       = oc.TopoDS.Face_1(faceExplorer.Current());
                const faceLoc    = new oc.TopLoc_Location_1();
                const polyHandle = oc.BRep_Tool.Triangulation(face, faceLoc);

                if (polyHandle.IsNull()) {
                    faceExplorer.Next();
                    globalFaceId++;
                    continue;
                }

                const tris       = polyHandle.get();
                const nNodes     = tris.NbNodes();
                const nTris      = tris.NbTriangles();
                const hasFaceTrsf = !faceLoc.IsIdentity();
                const faceTrsf    = hasFaceTrsf ? faceLoc.Transformation() : null;
                const isReversed  = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
                const sign        = isReversed ? -1 : 1;
                const hasNormals  = tris.HasNormals();

                for (let v = 1; v <= nNodes; v++) {
                    const pnt = tris.Node(v);
                    let x = pnt.X(), y = pnt.Y(), z = pnt.Z();

                    // ① 面のローカル変換
                    if (hasFaceTrsf && faceTrsf) {
                        const tp = pnt.Transformed(faceTrsf);
                        x = tp.X(); y = tp.Y(); z = tp.Z();
                    }
                    // ② アセンブリ累積変換
                    [x, y, z] = applyAssemblyTrsf(x, y, z);

                    partPositions.push(x, y, z);
                    partFaceIds.push(globalFaceId);

                    if (hasNormals) {
                        const n = tris.Normal(v);
                        let nx = n.X() * sign;
                        let ny = n.Y() * sign;
                        let nz = n.Z() * sign;

                        // ① 面のローカル回転を法線に適用
                        if (hasFaceTrsf && faceTrsf) {
                            const tn = new oc.gp_Vec_1(nx, ny, nz).Transformed(faceTrsf);
                            nx = tn.X(); ny = tn.Y(); nz = tn.Z();
                        }
                        // ② アセンブリ累積回転を法線に適用
                        [nx, ny, nz] = applyAssemblyTrsfNormal(nx, ny, nz);

                        partNormals.push(nx, ny, nz);
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

            if (partPositions.length === 0) continue;

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(partPositions, 3));
            geometry.setAttribute('normal',   new THREE.Float32BufferAttribute(partNormals, 3));

            const faceIdArray = new Float32Array(partFaceIds);
            geometry.setAttribute('faceId', new THREE.BufferAttribute(faceIdArray, 1));
            geometry.setIndex(partIndices);

            const hasZeroNormal = partNormals.some((v, i) =>
                i % 3 === 1 && partNormals[i - 1] === 0 && v === 1 && partNormals[i + 1] === 0
            );
            if (hasZeroNormal) geometry.computeVertexNormals();

            const vertexCount  = partPositions.length / 3;
            const defaultColor = new THREE.Color('#ecf0f1');
            const colors       = new Float32Array(vertexCount * 3);
            for (let i = 0; i < vertexCount; i++) {
                colors[i * 3]     = defaultColor.r;
                colors[i * 3 + 1] = defaultColor.g;
                colors[i * 3 + 2] = defaultColor.b;
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

            const material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.05,
                roughness: 0.65,
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = `Solid_Part_${solidId}`;
            mesh.castShadow    = true;
            mesh.receiveShadow = true;

            // ── B-Rep エッジからポリラインを構築 ────────────────────────

            const CURVE_SAMPLE_STEPS = 24;
            const brepEdgePositions  = [];
            const brepEdgeIds        = [];

            const edgeExp = new oc.TopExp_Explorer_1();
            edgeExp.Init(solid, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);

            while (edgeExp.More()) {
                const edge = oc.TopoDS.Edge_1(edgeExp.Current());

                if (oc.BRep_Tool.Degenerated(edge)) {
                    edgeExp.Next();
                    continue;
                }

                // ★ edgeKey に solidId を含めて同一形状の別インスタンスを区別
                let edgeKey = null;
                try {
                    const u1Ref = { current: 0 }, u2Ref = { current: 0 };
                    oc.BRep_Tool.Range_1(edge, u1Ref, u2Ref);
                    const pFirst = oc.BRep_Tool.Pnt(oc.TopExp.FirstVertex_1(edge));
                    const pLast  = oc.BRep_Tool.Pnt(oc.TopExp.LastVertex_1(edge));
                    edgeKey = `s${solidId}_${u1Ref.current.toFixed(4)}_${u2Ref.current.toFixed(4)}_` +
                              `${pFirst.X().toFixed(4)}_${pFirst.Y().toFixed(4)}_${pFirst.Z().toFixed(4)}_` +
                              `${pLast.X().toFixed(4)}_${pLast.Y().toFixed(4)}_${pLast.Z().toFixed(4)}`;
                } catch (_) {
                    if (edge && edge.$$) edgeKey = `s${solidId}_ptr_${edge.$$.ptr}`;
                }

                if (edgeKey && globalEdgeSet.has(edgeKey)) { edgeExp.Next(); continue; }
                if (edgeKey) globalEdgeSet.add(edgeKey);

                const assignedGlobalId = globalEdgeId;
                let edgeHandled = false;

                // 優先① Polygon3D
                const locPoly      = new oc.TopLoc_Location_1();
                const poly3dHandle = oc.BRep_Tool.Polygon3D(edge, locPoly);
                if (!poly3dHandle.IsNull()) {
                    const poly3d    = poly3dHandle.get();
                    const nPts      = poly3d.NbNodes();
                    const hasP3Trsf = !locPoly.IsIdentity();
                    const p3Trsf    = hasP3Trsf ? locPoly.Transformation() : null;

                    for (let pi = 1; pi <= nPts - 1; pi++) {
                        const pA = poly3d.Nodes().Value(pi);
                        const pB = poly3d.Nodes().Value(pi + 1);
                        let ax = pA.X(), ay = pA.Y(), az = pA.Z();
                        let bx = pB.X(), by = pB.Y(), bz = pB.Z();
                        if (hasP3Trsf && p3Trsf) {
                            const tpA = pA.Transformed(p3Trsf);
                            const tpB = pB.Transformed(p3Trsf);
                            ax = tpA.X(); ay = tpA.Y(); az = tpA.Z();
                            bx = tpB.X(); by = tpB.Y(); bz = tpB.Z();
                        }
                        [ax, ay, az] = applyAssemblyTrsf(ax, ay, az);
                        [bx, by, bz] = applyAssemblyTrsf(bx, by, bz);
                        brepEdgePositions.push(ax, ay, az, bx, by, bz);
                        brepEdgeIds.push(assignedGlobalId, assignedGlobalId);
                    }
                    edgeHandled = true;
                }

                // 優先② 3D曲線サンプリング
                if (!edgeHandled) {
                    try {
                        const u1Ref = { current: 0 }, u2Ref = { current: 0 };
                        const curve3dHandle = oc.BRep_Tool.Curve_1(edge, u1Ref, u2Ref);
                        if (!curve3dHandle.IsNull()) {
                            const curve3d     = curve3dHandle.get();
                            const edgeLoc     = edge.Location_1();
                            const hasEdgeTrsf = !edgeLoc.IsIdentity();
                            const edgeTrsf    = hasEdgeTrsf ? edgeLoc.Transformation() : null;
                            const sampledPts  = [];

                            for (let si = 0; si <= CURVE_SAMPLE_STEPS; si++) {
                                const t   = u1Ref.current + (u2Ref.current - u1Ref.current) * (si / CURVE_SAMPLE_STEPS);
                                const p3d = curve3d.Value(t);
                                let x = p3d.X(), y = p3d.Y(), z = p3d.Z();
                                if (hasEdgeTrsf && edgeTrsf) {
                                    const tp = p3d.Transformed(edgeTrsf);
                                    x = tp.X(); y = tp.Y(); z = tp.Z();
                                }
                                [x, y, z] = applyAssemblyTrsf(x, y, z);
                                sampledPts.push(x, y, z);
                            }
                            for (let si = 0; si < CURVE_SAMPLE_STEPS; si++) {
                                const base = si * 3;
                                brepEdgePositions.push(
                                    sampledPts[base],     sampledPts[base + 1], sampledPts[base + 2],
                                    sampledPts[base + 3], sampledPts[base + 4], sampledPts[base + 5]
                                );
                                brepEdgeIds.push(assignedGlobalId, assignedGlobalId);
                            }
                            edgeHandled = true;
                        }
                    } catch (e) { console.debug(e); }
                }

                // 優先③ CurveOnSurface
                if (!edgeHandled) {
                    try {
                        const faceExpC = new oc.TopExp_Explorer_1();
                        faceExpC.Init(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
                        while (faceExpC.More() && !edgeHandled) {
                            const faceC      = oc.TopoDS.Face_1(faceExpC.Current());
                            const locC       = new oc.TopLoc_Location_1();
                            const u1Ref      = { current: 0 }, u2Ref = { current: 0 };
                            const curveHandle = oc.BRep_Tool.CurveOnSurface_1(edge, faceC, u1Ref, u2Ref);
                            if (curveHandle.IsNull()) { faceExpC.Next(); continue; }
                            const surfHandle = oc.BRep_Tool.Surface_2(faceC, locC);
                            if (surfHandle.IsNull()) { faceExpC.Next(); continue; }

                            const surf       = surfHandle.get();
                            const pcurve     = curveHandle.get();
                            const hasSurfTrsf = !locC.IsIdentity();
                            const surfTrsf2   = hasSurfTrsf ? locC.Transformation() : null;
                            const sampledPts  = [];

                            for (let si = 0; si <= CURVE_SAMPLE_STEPS; si++) {
                                const t   = u1Ref.current + (u2Ref.current - u1Ref.current) * (si / CURVE_SAMPLE_STEPS);
                                const uv  = pcurve.Value(t);
                                const p3d = surf.Value(uv.X(), uv.Y());
                                let sx = p3d.X(), sy = p3d.Y(), sz = p3d.Z();
                                if (hasSurfTrsf && surfTrsf2) {
                                    const tp = p3d.Transformed(surfTrsf2);
                                    sx = tp.X(); sy = tp.Y(); sz = tp.Z();
                                }
                                [sx, sy, sz] = applyAssemblyTrsf(sx, sy, sz);
                                sampledPts.push(sx, sy, sz);
                            }
                            for (let si = 0; si < CURVE_SAMPLE_STEPS; si++) {
                                const base = si * 3;
                                brepEdgePositions.push(
                                    sampledPts[base],     sampledPts[base + 1], sampledPts[base + 2],
                                    sampledPts[base + 3], sampledPts[base + 4], sampledPts[base + 5]
                                );
                                brepEdgeIds.push(assignedGlobalId, assignedGlobalId);
                            }
                            edgeHandled = true;
                            faceExpC.Next();
                        }
                    } catch (e) { console.debug(e); }
                }

                // 優先④ PolygonOnTriangulation
                if (!edgeHandled) {
                    const faceExp2 = new oc.TopExp_Explorer_1();
                    faceExp2.Init(solid, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
                    while (faceExp2.More() && !edgeHandled) {
                        const face2     = oc.TopoDS.Face_1(faceExp2.Current());
                        const loc2      = new oc.TopLoc_Location_1();
                        const triH      = oc.BRep_Tool.Triangulation(face2, loc2);
                        if (triH.IsNull()) { faceExp2.Next(); continue; }
                        const polyOnTriH = oc.BRep_Tool.PolygonOnTriangulation_1(edge, triH, loc2);
                        if (polyOnTriH.IsNull()) { faceExp2.Next(); continue; }

                        const polyOnTri  = polyOnTriH.get();
                        const tris2      = triH.get();
                        const nPts2      = polyOnTri.NbNodes();
                        const hasTrsf2   = !loc2.IsIdentity();
                        const trsf2      = hasTrsf2 ? loc2.Transformation() : null;

                        for (let pi = 1; pi <= nPts2 - 1; pi++) {
                            const pA = tris2.Node(polyOnTri.Nodes().Value(pi));
                            const pB = tris2.Node(polyOnTri.Nodes().Value(pi + 1));
                            let ax = pA.X(), ay = pA.Y(), az = pA.Z();
                            let bx = pB.X(), by = pB.Y(), bz = pB.Z();
                            if (hasTrsf2 && trsf2) {
                                const tpA = pA.Transformed(trsf2);
                                const tpB = pB.Transformed(trsf2);
                                ax = tpA.X(); ay = tpA.Y(); az = tpA.Z();
                                bx = tpB.X(); by = tpB.Y(); bz = tpB.Z();
                            }
                            [ax, ay, az] = applyAssemblyTrsf(ax, ay, az);
                            [bx, by, bz] = applyAssemblyTrsf(bx, by, bz);
                            brepEdgePositions.push(ax, ay, az, bx, by, bz);
                            brepEdgeIds.push(assignedGlobalId, assignedGlobalId);
                        }
                        edgeHandled = true;
                        faceExp2.Next();
                    }
                }

                globalEdgeId++;
                edgeExp.Next();
            }

            const partGroup = new THREE.Group();
            partGroup.name  = `PartGroup_Solid_${solidId}`;
            partGroup.add(mesh);

            let edgeLines;
            if (brepEdgePositions.length > 0) {
                const edgeGeom = new THREE.BufferGeometry();
                edgeGeom.setAttribute('position', new THREE.Float32BufferAttribute(brepEdgePositions, 3));
                edgeGeom.setAttribute('edgeId', new THREE.BufferAttribute(new Float32Array(brepEdgeIds), 1));
                const edgeMaterial = new THREE.LineBasicMaterial({
                    color: 0x3b82f6,
                    linewidth: 1,
                    transparent: true,
                    opacity: 0.85
                });
                edgeLines = new THREE.LineSegments(edgeGeom, edgeMaterial);
                edgeLines.raycast = THREE.LineSegments.prototype.raycast;
            } else if (mesh && mesh.geometry) {
                edgeLines = new THREE.LineSegments(
                    new THREE.EdgesGeometry(mesh.geometry, 24),
                    edgesMaterial
                );
            }

            if (edgeLines) {
                edgeLines.name    = 'edgeLines';
                edgeLines.visible = showEdges;
                partGroup.add(edgeLines);
            }

            currentModel.add(partGroup);
        }

        await updateProgress('画面の描画を最適化中...', 98);

        if (partsContainer) {
            partsContainer.innerHTML = '';
            currentModel.children.forEach((partGroup) => {
                if (partGroup.isGroup && partGroup.name.startsWith('PartGroup_Solid_')) {
                    const solidIdx    = partGroup.name.replace('PartGroup_Solid_', '');
                    const partLabelText = `パーツ ${Number(solidIdx) + 1}`;

                    const label    = document.createElement('label');
                    label.className = 'part-check-label';
                    const checkbox = document.createElement('input');
                    checkbox.type    = 'checkbox';
                    checkbox.checked = true;

                    checkbox.addEventListener('change', (e) => {
                        partGroup.visible = e.target.checked;
                        if (!e.target.checked) clearHighlight();
                    });

                    label.addEventListener('mouseenter', () => {
                        clearHighlight();
                        const mesh = partGroup.children.find(child => child.isMesh);
                        if (!mesh) return;

                        const highlightGeom = mesh.geometry.clone();
                        highlightGroup = new THREE.Group();
                        highlightGroup.name = 'dynamicHighlightGroup';

                        const faceMat = new THREE.MeshBasicMaterial({
                            color: 0xff0000, transparent: true, opacity: 0.35,
                            side: THREE.DoubleSide, depthTest: true, depthWrite: false
                        });
                        highlightGroup.add(new THREE.Mesh(highlightGeom, faceMat));

                        const edgesMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 1, depthTest: true });
                        highlightGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(highlightGeom, 24), edgesMat));

                        highlightGroup.position.copy(mesh.position);
                        highlightGroup.rotation.copy(mesh.rotation);
                        highlightGroup.scale.copy(mesh.scale).multiplyScalar(1.0005);
                        scene.add(highlightGroup);
                    });

                    label.addEventListener('mouseleave', () => clearHighlight());
                    label.appendChild(checkbox);
                    label.appendChild(document.createTextNode(partLabelText));
                    partsContainer.appendChild(label);
                }
            });
        }

        scene.add(currentModel);
        triCountLabel.innerText = totalTriangles.toLocaleString();

        {
            const box    = new THREE.Box3().setFromObject(currentModel);
            const size   = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            raycaster.params.Line = { threshold: Math.max(0.5, maxDim * 0.008) };
        }

        triggerAutoFit();
        await updateProgress('インポート完了！', 100);
        setTimeout(() => { loading.style.display = 'none'; }, 300);

        console.log(`STEP loaded: ${totalSolids} parts, ${globalFaceId} faces.`);
        console.log(`総有効一意エッジ数: ${globalEdgeId}`);

    } catch (err) {
        console.error(err);
        const loadingText = document.getElementById('loading-text');
        if (loadingText) loadingText.innerText = `❌ 読み込み失敗: ${err.message}`;
    }
}

////////////////////////////////////////////////////////////
// Paint Core
////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////
// マウスクリック時の判定・処理 (測定エッジ/面ペイント)
////////////////////////////////////////////////////////////
function checkAndPaint(clientX, clientY) {
    
    const selectModeElem = document.querySelector('input[name="selectMode"]:checked');
    const isEdgeSelection = selectModeElem && selectModeElem.value.toLowerCase() === 'edge';
    console.log("isEdgeSelection")
    console.log(isEdgeSelection)
    if (isEdgeSelection) {
        // 線を精密に感知するために threshold を設定
        raycaster.params.Line = { threshold: 0.4 };
        
        console.log("🚀 【確認】isEdgeSelectionのブロックに正常に進入しました！");
        const intersects = raycaster.intersectObjects(currentModel.children, true);
        const edgeIntersect = intersects.find(hit => hit.object.isLineSegments && hit.object.name === 'edgeLines');
        
        if (edgeIntersect && edgeIntersect.object.parent && edgeIntersect.object.parent.visible !== false) {
            const clickedPoint = edgeIntersect.point;
            const geometry = edgeIntersect.object.geometry;
            const edgeIdAttr = geometry.attributes.edgeId;
            
            if (edgeIdAttr && edgeIntersect.index !== undefined) {

                const clickedEdgeId = edgeIdAttr.array[edgeIntersect.index];
                
                console.log(`🎯 [測定システム検知] 選択された実際のエッジID: ${clickedEdgeId} (元インデックス: ${edgeIntersect.index})`);
                const allEdgeIds = Array.from(edgeIdAttr.array);
                console.log("📊 【データ検証】このパーツに含まれる全頂点のエッジIDリスト（総頂点数: " + allEdgeIds.length + "):", allEdgeIds);

                // ユニーク（重複排除）なIDのリストだけをスッキリ見たい場合はこちらも便利です
                const uniqueEdgeIds = [...new Set(allEdgeIds)];
                console.log("✨ 【データ検証】このパーツを構成する一意なエッジIDの一覧:", uniqueEdgeIds);
                // 画面表示用のラベルを更新（もしUIにエッジID表示用の場所があれば連動）
                if (faceIdLabel) faceIdLabel.innerText = clickedEdgeId;
                if (meshNameLabel) meshNameLabel.innerText = `Edge_${clickedEdgeId}`;
            } else {
                console.log("⚠️ エッジは感知しましたが、geometryにedgeId属性がありません:", clickedPoint);
            }
            
            // 💡 測定モードがONの場合のみ、距離測定用配列へ座標を登録
            if (isMeasureMode) {
                if (typeof addMeasurePoint === 'function') {
                    console.log("1")
                    addMeasurePoint(clickedPoint);
                } else if (typeof measurePoints !== 'undefined') {
                    console.log("2")
                    measurePoints.push(clickedPoint);
                    if (typeof updateMeasureVisuals === 'function') {
                        console.log("3")
                        updateMeasureVisuals();
                    }
                }
            }
            return; // エッジ判定を完了したため、後続の面ペイント処理には流さない
        } else {
            console.log("ℹ️ エッジモードですが、クリックした位置にエッジ線（edgeLines）がヒットしませんでした。");
        }
    }

    // ────────────────────────────────────────────────────────
    // 📦 従来の処理（通常モード時の面・パーツのカラーペイント判定）
    // ────────────────────────────────────────────────────────
    const intersects = raycaster.intersectObjects(currentModel.children, true);
    if (intersects.length === 0) return;
    if (isEdgeSelection) return;

    const intersect = intersects.find(hit => hit.object.isMesh);
    if (!intersect) return;

    // 非表示状態のパーツはペイント対象から除外
    if (intersect.object.parent && intersect.object.parent.visible === false) return;

    const hitTriangle = intersect.faceIndex;
    if (hitTriangle === undefined) return;

    const targetMesh = intersect.object;
    const geometry = targetMesh.geometry;
    const indexAttr = geometry.index;
    const faceIdAttr = geometry.attributes.faceId;
    if (!indexAttr || !faceIdAttr) return;

    const vertexIndex = indexAttr.getX(hitTriangle * 3);
    const faceIdVal = Math.round(faceIdAttr.getX(vertexIndex));

    if (faceIdLabel) faceIdLabel.innerText = faceIdVal;
    if (meshNameLabel) meshNameLabel.innerText = `Face_${faceIdVal}`;

    const paintModeElement = document.querySelector('input[name="paintMode"]:checked');
    const paintMode = paintModeElement ? paintModeElement.value : 'face';

    // 最初の実変更時だけ履歴保存
    if (!paintChangedThisSession) {
        saveHistory();
        paintChangedThisSession = true;
    }

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
// マウスオーバー時のハイライト処理 (エッジ・フェイス対応)
////////////////////////////////////////////////////////////
function updateHighlight(clientX, clientY) {
    
    if (!currentModel) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    camera.updateProjectionMatrix();
    raycaster.setFromCamera(mouse, camera);

    // ── 📐 測定モード中のエッジ選択判定 ──
    const selectModeElem = document.querySelector('input[name="selectionMode"]:checked');
    const isEdgeSelection = selectModeElem && selectModeElem.value === 'edge';

    if (isMeasureMode && isEdgeSelection) {
        // 線を拾いやすくするために一時的にレイキャスターの閾値を設定（3D空間上の距離）
        raycaster.params.Line = { threshold: 0.5 };
        console.log("測定かつ")


        const intersects = raycaster.intersectObjects(currentModel.children, true);
        const edgeIntersect = intersects.find(hit => hit.object.isLineSegments && hit.object.name === 'edgeLines');

        if (!edgeIntersect || (edgeIntersect.object.parent && edgeIntersect.object.parent.visible === false)) {
            clearEdgeHighlight();
            return;
        }

        const lineObj = edgeIntersect.object;
        const edgeIdAttr = lineObj.geometry.attributes.edgeId;
        const hitIndex = edgeIntersect.index; // ヒットしたセグメントの頂点インデックス

        if (edgeIdAttr && hitIndex !== undefined) {
            const edgeIdVal = Math.round(edgeIdAttr.getX(hitIndex));

            // すでにハイライト済みならスキップ
            if (hoveredEdgeId === edgeIdVal) return;
            clearEdgeHighlight();
            hoveredEdgeId = edgeIdVal;

            // ── エッジを構成するすべての線分（点列）を取り出す ──
            const positionAttr = lineObj.geometry.attributes.position;
            const edgePositions = [];
            const posCount = edgeIdAttr.count;
            for (let i = 0; i < posCount; i++) {
                if (Math.round(edgeIdAttr.getX(i)) === edgeIdVal) {
                    edgePositions.push(
                        positionAttr.getX(i),
                        positionAttr.getY(i),
                        positionAttr.getZ(i)
                    );
                }
            }

            // ── ホバーハイライト用の LineSegments を生成 ──
            const hGeometry = new THREE.BufferGeometry();
            hGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
            
            const hMaterial = new THREE.LineBasicMaterial({
                color: 0x00ffff,      // シアン（目立つ蛍光水色）
                linewidth: 3,         // 太線指定（環境により1固定の場合もあります）
                depthTest: false      // モデルの裏に隠れず、最前面に強制描画
            });

            hoveredEdgeHighlight = new THREE.LineSegments(hGeometry, hMaterial);
            hoveredEdgeHighlight.renderOrder = 999; // 描画順位を最上位に
            scene.add(hoveredEdgeHighlight);
        }
        return; // エッジ判定を処理したため、面のハイライト処理はスキップ
    }

    // 面選択中の場合は、エッジハイライトをクリアして通常処理へ
    clearEdgeHighlight();

    // ── 📦 従来の面・パーツハイライト処理 ──
    const intersects = raycaster.intersectObjects(currentModel.children, true);
    const intersect = intersects.find(hit => hit.object.isMesh);
    if (!intersect || (intersect.object.parent && intersect.object.parent.visible === false)) {
        clearHighlight();
        return;
    }

    const hitTriangle = intersect.faceIndex;
    if (hitTriangle === undefined) return;

    const targetMesh = intersect.object;
    const geometry = targetMesh.geometry;
    const indexAttr = geometry.index;
    const faceIdAttr = geometry.attributes.faceId;
    if (!indexAttr || !faceIdAttr) return;

    const vertexIndex = indexAttr.getX(hitTriangle * 3);
    const faceIdVal = Math.round(faceIdAttr.getX(vertexIndex));

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
    const faceMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: true, depthWrite: false });
    const highlightMesh = new THREE.Mesh(highlightGeom, faceMat);
    highlightGroup.add(highlightMesh);

    const edgesGeom = new THREE.EdgesGeometry(highlightGeom, 24);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 1 });
    const highlightEdgeMesh = new THREE.LineSegments(edgesGeom, edgesMat);
    highlightGroup.add(highlightEdgeMesh);

    scene.add(highlightGroup);
}

// エッジハイライトを完全に消去するヘルパー関数（追加）
function clearEdgeHighlight() {
    if (hoveredEdgeHighlight) {
        scene.remove(hoveredEdgeHighlight);
        hoveredEdgeHighlight.geometry.dispose();
        hoveredEdgeHighlight.material.dispose();
        hoveredEdgeHighlight = null;
    }
    hoveredEdgeId = -1;
}

function clearHighlight() {
    // 既存の面のクリア処理
    if (highlightGroup) {
        scene.remove(highlightGroup);
        highlightGroup.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        highlightGroup = null;
    }
    hoveredFaceId = null;

    // ── 💡 追加：エッジハイライトも同時にリセット ──
    clearEdgeHighlight(); 
}


////////////////////////////////////////////////////////////
// Pointer Events
////////////////////////////////////////////////////////////

canvas.addEventListener('pointerdown', (e) => {
    const selectModeElem = document.querySelector('input[name="selectMode"]:checked');
    const currentMode = selectModeElem ? selectModeElem.value.toLowerCase() : 'face';

    // 💡 修正：メモモード、または（測定モードかつエッジ選択以外）の時に return する
    if (isMemoMode || (isMeasureMode && currentMode !== 'edge')) {
        return;
    }

    if (e.button === 0 && !e.shiftKey && !e.ctrlKey) {
        

        isLeftMouseDown = true;
        isRotating      = false;
    
        // ペイント開始時に1回だけ履歴保存
        isPaintingSession = true;
        paintChangedThisSession = false;

        checkAndPaint(e.clientX, e.clientY);
    } else {
        isRotating = true;
    }
});

canvas.addEventListener('pointermove', (e) => {
    // 測定モード ON かつ edge 選択モード時 → エッジのホバーハイライトを更新
    if (isMeasureMode) {
        const activeModeEl = document.querySelector('input[name="selectMode"]:checked');
        const selectMode = activeModeEl ? activeModeEl.value : 'vertex';
        if (selectMode === 'edge') {
            updateEdgeHoverHighlight(e.clientX, e.clientY);
        } else {
            clearEdgeHoverHighlight();
        }
        return;
    }

    if (isMemoMode) return;

    if (isLeftMouseDown && !isRotating) {
        controls.enabled = false;
        checkAndPaint(e.clientX, e.clientY);
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
    if (isMeasureMode || isMemoMode) return;
    isLeftMouseDown  = false;
    isRotating       = false;
    controls.enabled = true;

    // セッション終了
    isPaintingSession = false;
    paintChangedThisSession = false;

    clearHighlight();
};
window.addEventListener('pointerup', stopPainting);
canvas.addEventListener('pointerleave', stopPainting);


////////////////////////////////////////////////////////////
// Palette
////////////////////////////////////////////////////////////

if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
        console.log('Brush color:', e.target.value);
    });
}

document.querySelectorAll('.palette-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
        if (colorPicker) colorPicker.value = e.currentTarget.getAttribute('data-color');
    });
});


////////////////////////////////////////////////////////////
// Undo
////////////////////////////////////////////////////////////

function saveHistory() {
    if (!currentModel) return;

    const snapshot = [];

    currentModel.traverse((child) => {
        if (child.isMesh) {
            const attr = child.geometry?.attributes?.color;

            if (attr && attr.array) {
                snapshot.push({
                    meshUUID: child.uuid,
                    colors: attr.array.slice()
                });
            }
        }
    });

    colorHistory.push(snapshot);

    if (colorHistory.length > MAX_HISTORY) {
        colorHistory.shift();
    }
}

if (undoButton) {
    undoButton.addEventListener('click', () => {
        if (!colorHistory.length || !currentModel) return;

        const snapshot = colorHistory.pop();

        snapshot.forEach((entry) => {
            const mesh = currentModel.getObjectByProperty('uuid', entry.meshUUID);

            if (!mesh || !mesh.isMesh) return;

            const attr = mesh.geometry?.attributes?.color;

            if (!attr) return;

            // サイズ不一致防止
            if (attr.array.length !== entry.colors.length) {
                console.warn(
                    'Undo skipped due to size mismatch:',
                    mesh.name
                );
                return;
            }

            attr.array.set(entry.colors);
            attr.needsUpdate = true;
        });
    });
}


////////////////////////////////////////////////////////////
// Grid
////////////////////////////////////////////////////////////

const gridHelper = new THREE.GridHelper(500, 50, 0x444444, 0x2a2a2a);
gridHelper.name = 'gridHelper'; 
scene.add(gridHelper);


// ============================================================
// 💾 ① カラー ・ タグ ・ 複数メモデータの統合保存 (JSONエクスポート)
// ============================================================
if (saveColorsButton) {
    saveColorsButton.addEventListener('click', () => {
        if (!currentModel) { alert('モデルが読み込まれていません。'); return; }

        const faceColorMap = {};
        let totalVerticesProcessed = 0;

        // 1. モデルの全メッシュの頂点属性から現在のFaceカラーを動的抽出
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

        // 2. プリセット対応のカラータグ入力欄からテキストを収集
        let tagsData = [];
        if (typeof presetColors !== 'undefined' && Array.isArray(presetColors)) {
            tagsData = presetColors.map((_, index) => {
                const inputEl = document.getElementById(`tag-input-${index}`);
                return inputEl ? inputEl.value : '';
            });
        }

        // 3. 3Dポップアップメモデータのシリアライズ
        let serializedMemos = [];
        if (typeof memoList !== 'undefined' && Array.isArray(memoList)) {
            serializedMemos = memoList.map(memo => {
                const pt = memo.point || { x: 0, y: 0, z: 0 };
                return {
                    point: { x: pt.x, y: pt.y, z: pt.z },
                    text: memo.text || ''
                };
            });
        }

        const modelName = currentModel.userData.name || "model.step";

        // 👑 元の構造（faceColors, tags）を完全に保ったまま、memosを追加して一本化
        const exportData = {
            application: "STEP Face Viewer – FaceID Mode",
            timestamp: Date.now(),
            fileName: modelName,
            faceColors: faceColorMap, // 🎨 Faceカラーマッピング情報
            tags: tagsData,           // 🏷️ カラータグ情報
            memos: serializedMemos    // 📝 複数3Dメモ情報
        };

        // ファイルとしてダウンロード出力
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: 'step-colors-and-memos.json',
        });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        
        console.log(`Color mapping and memos saved successfully. Map size: ${Object.keys(faceColorMap).length}, Memos: ${serializedMemos.length}`);
    });
}

// ============================================================
// 📥 ② カラー ・ タグ ・ 複数メモデータの統合読み込み (JSONインポート)
// ============================================================
if (importColorsFile) {
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

                // 👑 【元コード準拠】Face数が異なる別モデルからの読み込みを安全に拒否するバリデーション
                if (typeof faceGroupMap !== 'undefined' && faceGroupMap.size > 0) {
                    const currentTotalFaces = faceGroupMap.size;
                    const jsonTotalFaces = Object.keys(data.faceColors).length;

                    if (currentTotalFaces !== jsonTotalFaces) {
                        alert(`❌ 異なるモデルのカラーデータです。\n\n現在のモデルのFace数: ${currentTotalFaces}\nJSONのFace数: ${jsonTotalFaces}\n\n読み込みを中止しました。`);
                        e.target.value = '';
                        return; 
                    }
                }

                // 履歴の保存（アンドゥ用）
                currentModel.traverse((child) => {
                    if (child.isMesh && typeof saveHistory === 'function') saveHistory(child);
                });

                // 1. カラーデータの復元（各頂点属性へ再流し込み）
                const tempColor = new THREE.Color();
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
                                }
                            }
                            colorAttr.needsUpdate = true;
                        }
                    }
                });

                // 2. カラータグ情報の復元
                if (data.tags && Array.isArray(data.tags)) {
                    data.tags.forEach((tagText, index) => {
                        const inputEl = document.getElementById(`tag-input-${index}`);
                        if (inputEl) inputEl.value = tagText || '';
                    });
                }

                // 3. 👑 3Dポップアップメモ情報の完全復元
                if (typeof clearAllMemos === 'function') {
                    clearAllMemos(); // 既存のメモを画面とメモリから一度リセット
                }

                if (data.memos && Array.isArray(data.memos) && typeof restoreMemoFromData === 'function') {
                    data.memos.forEach(memoData => {
                        if (memoData.point) {
                            const position = new THREE.Vector3(memoData.point.x, memoData.point.y, memoData.point.z);
                            // 以前作成した復元用ヘルパーで、ピンとウィンドウを再ビルド
                            restoreMemoFromData(position, memoData.text || '');
                        }
                    });
                }

                // 現在のメモモードの起動状態にあわせて、インポートしたミニウィンドウの表示状態を即時同期
                if (typeof isMemoMode !== 'undefined' && isMemoMode) {
                    if (typeof showAllMemoElements === 'function') showAllMemoElements();
                } else {
                    if (typeof hideAllMemoElements === 'function') hideAllMemoElements();
                }

                alert('FaceIDマッピングに基づき、カラーデータ・タグ・メモ情報を完全復元しました。');
            } catch (err) {
                console.error(err);
                alert('JSON 読み込み失敗: ' + err.message);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    });
}


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
    // 注: TrackballControls には saveState() が無いため削除。
    // (controls.reset() はこのアプリでは呼ばれていないため、機能への影響はありません)
}

if (resetViewButton) {
    resetViewButton.addEventListener('click', () => {
        triggerAutoFit();
        console.log('View reset: Direction and camera.zoom re-fitted perfectly.');
    });
}

////////////////////////////////////////////////////////////
// 操作メニュー (Help Modal) の制御
////////////////////////////////////////////////////////////
const btnHelp       = document.getElementById('btn-help');
const helpOverlay   = document.getElementById('help-overlay');
const btnCloseHelp  = document.getElementById('btn-close-help');

if (btnHelp && helpOverlay && btnCloseHelp) {
    // 操作確認ボタンを押したときに表示
    btnHelp.addEventListener('click', () => {
        helpOverlay.classList.add('active');
    });

    // 閉じるボタンを押したときに非表示
    btnCloseHelp.addEventListener('click', () => {
        helpOverlay.classList.remove('active');
    });

    // 背景の黒い部分（オーバーレイ）をクリックしたときも閉じるようにする
    helpOverlay.addEventListener('click', (e) => {
        if (e.target === helpOverlay) {
            helpOverlay.classList.remove('active');
        }
    });
}

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

if (viewPosXBtn) viewPosXBtn.addEventListener('click', () => setCameraDirection('x', 1));
if (viewNegXBtn) viewNegXBtn.addEventListener('click', () => setCameraDirection('x', -1));
if (viewPosYBtn) viewPosYBtn.addEventListener('click', () => setCameraDirection('y', 1));
if (viewNegYBtn) viewNegYBtn.addEventListener('click', () => setCameraDirection('y', -1));
if (viewPosZBtn) viewPosZBtn.addEventListener('click', () => setCameraDirection('z', 1));
if (viewNegZBtn) viewNegZBtn.addEventListener('click', () => setCameraDirection('z', -1));

if (centerButton) {
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
}


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
    controls.handleResize(); // TrackballControls は画面サイズをキャッシュしているため必須
});
// ============================================================
// 👑 拡張機能用：追加ステート（複数メモ・永続管理化）
// ============================================================
let isMemoMode = false;         // メモ配置モードがONか
let memoList = [];              // 登録されたメモの配列 { id, point, text, marker, element }

const toolStatusBadge = document.getElementById('tool-status-badge');

// ============================================================
// 📏 モード管理 ＆ 排他制御 ＆ 状態表示ユーティリティ
// ============================================================
function updateToolStatusUI() {
    if (!toolStatusBadge) return;
    
    if (isMeasureMode) {
        toolStatusBadge.innerText = "📏 距離測定モード有効 (モデル上をクリック / [ESC] で解除)";
        toolStatusBadge.style.background = "rgba(231, 76, 60, 0.95)"; 
        toolStatusBadge.style.color = "#fff";
        toolStatusBadge.style.display = "block";
    } else if (isMemoMode) {
        toolStatusBadge.innerText = "📝 メモ配置モード有効 (モデル面をクリックして複数設置 / [ESC] で解除)";
        toolStatusBadge.style.background = "rgba(241, 196, 15, 0.95)"; 
        toolStatusBadge.style.color = "#111";
        toolStatusBadge.style.display = "block";
    } else {
        toolStatusBadge.style.display = "none";
        toolStatusBadge.style.color = "#fff";
    }
}

// 距離測定モードの切り替え（メモとは排他）
toggleMeasureMode = function (forceState = null) {
    isMeasureMode = forceState !== null ? forceState : !isMeasureMode;
    if (isMeasureMode) {
        toggleMemoMode(false);
        if (measureLabel) measureLabel.style.display = 'block';
        if (btnToolMeasure) btnToolMeasure.style.background = '#b45309';
        if (selectionModePanel) selectionModePanel.style.display = 'flex'; // ← 追加
        clearMeasure();
    } else {
        if (measureLabel) measureLabel.style.display = 'none';
        if (btnToolMeasure) btnToolMeasure.style.background = '';
        if (selectionModePanel) selectionModePanel.style.display = 'none'; // ← 追加
        clearMeasure();
    }
    updateToolStatusUI();
}

// メモモードの切り替え（距離測定とは排他）
function toggleMemoMode(forceState = null) {
    isMemoMode = forceState !== null ? forceState : !isMemoMode;
    const memoExportPanel = document.getElementById('memo-export-panel');
    if (isMemoMode) {
        toggleMeasureMode(false); // 距離測定モードは強制終了
        if (btnToolMemo) btnToolMemo.style.background = '#b45309';
        // 💡 再びONになったとき、既存のすべてのメモUI（ミニウィンドウ）を再表示
        showAllMemoElements();
        // メモ管理メニューパネルを左下に表示
        if (memoExportPanel) memoExportPanel.style.display = 'block';
    } else {
        if (btnToolMemo) btnToolMemo.style.background = '';
        // 💡 モードOFFの時は、画面が煩雑にならないようメモUI（ミニウィンドウ）を一旦すべて非表示
        hideAllMemoElements();
        // メモ管理メニューパネルを非表示
        if (memoExportPanel) memoExportPanel.style.display = 'none';
    }
    updateToolStatusUI();
}

// メモUI要素の全非表示
function hideAllMemoElements() {
    memoList.forEach(memo => {
        if (memo.element) memo.element.style.display = 'none';
    });
}

// メモUI要素の全表示（位置も即時更新）
function showAllMemoElements() {
    memoList.forEach(memo => {
        if (memo.element) {
            memo.element.style.display = 'block';
            updateSingleMemoPosition(memo);
        }
    });
}

// ============================================================
// 🛠️ イベント割り込み・完全ガード (距離測定 OR メモモード時にペイントを阻止)
// ============================================================
const preventPaintHandler = (e) => {
    if (isMeasureMode || isMemoMode) {
        e.stopPropagation();
    }
};
canvas.addEventListener('mousedown', preventPaintHandler, true);
canvas.addEventListener('mouseup', preventPaintHandler, true);
canvas.addEventListener('click', preventPaintHandler, true);

// ============================================================
// 📱 タッチデバイス専用：高度な操作挙動最適化ロジック
// ============================================================

let isTouchingModel = false;    // タッチ開始時にモデルの上にいたか
let lastTouchPos = { x: 0, y: 0 };

// タッチデバイスかどうかを判定する簡易関数
function isTouchDevice(e) {
    return e.touches && e.touches.length > 0;
}

// スクリーン座標からレイキャストを実行し、モデルとの交差を返すヘルパー
function getTouchIntersect(touch) {
    if (!currentModel) return null;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(currentModel.children, true);
    return intersects.find(hit => hit.object.isMesh);
}

// --- ① タッチ開始 (touchstart) ---
canvas.addEventListener('touchstart', (e) => {
    // 距離測定・メモモードがONの時は、競合を防ぐため既存の特殊処理に委ねる
    if (isMeasureMode || isMemoMode) return;

    if (e.touches.length === 1) {
        // 1本指タッチの場合
        const touch = e.touches[0];
        lastTouchPos = { x: touch.clientX, y: touch.clientY };
        
        const intersect = getTouchIntersect(touch);

        if (intersect) {
            // A. モデルの上でタッチ開始 → 「タップで色付け / スワイプで連続色付け」モード
            isTouchingModel = true;
            
            // TrackballControlsが勝手にカメラを回転させないように一時ロック
            // (enableRotate/enablePan は OrbitControls 専用のため noRotate/noPan で代替)
            controls.noRotate = true;
            
            // 即座に最初の1点をペイント（タップ色付け対応）
            e.stopPropagation();
            e.preventDefault();
            
            // 既存のペイント関数(例: paintFace など)があれば呼び出し
            // ※ もしpointerdown等の共通処理がある場合は、そちらのロジックに流すかここで色を直接変えます
            if (typeof onPointerDown === 'function') {
                // 内部のRaycastやマウスクリックイベントを擬似的にシミュレート、または下記のように直接処理
                handleSinglePaint(intersect);
            } else {
                handleSinglePaint(intersect);
            }
        } else {
            // B. 何もない空間でタッチ開始
            // TrackballControls では1本指の割り当てを個別に「パン」へ切り替えることができず、
            // 1本指＝回転 / 2本指以上＝ズーム＋パン、という仕様に固定されています（トラックボール式の標準挙動）。
            // そのため、ここでは何もない空間の1本指タッチは素直にTrackballControls任せの回転として扱います。
            isTouchingModel = false;
            controls.noRotate = false;
        }
    } else if (e.touches.length === 2) {
        // 2本指タッチの場合 → TrackballControlsが自動でズーム＋パンを処理
        isTouchingModel = false;
        controls.noRotate = false;
        controls.noPan    = false;
    }
}, { passive: false });


// --- ② タッチ移動中 (touchmove) ---
canvas.addEventListener('touchmove', (e) => {
    if (isMeasureMode || isMemoMode) return;

    if (e.touches.length === 1) {
        if (isTouchingModel) {
            // A. モデル上で始まった1本指スワイプ → 「連続色付け」
            e.stopPropagation();
            e.preventDefault(); // 画面スクロールやカメラ回転を完全にブロック

            const touch = e.touches[0];
            const intersect = getTouchIntersect(touch);
            if (intersect) {
                handleSinglePaint(intersect); // ドラッグ経路上の面を連続ペイント
            }
        } else {
            // B. 何もない空間で始まった1本指スワイプ → 「パン移動」
            // OrbitControlsが自動的にパン移動を処理するため、イベントの阻止はせず流す
        }
    }
}, { passive: false });


// --- ③ タッチ終了 (touchend) ---
canvas.addEventListener('touchend', (e) => {
    // 操作が終わったら、TrackballControlsの挙動をデフォルト設定に綺麗にリセット
    isTouchingModel = false;
    controls.noRotate = false;
    controls.noPan    = false;
});


// 💡 タッチ操作からFaceIDを狙い撃ちしてペイントする共通ヘルパー
function handleSinglePaint(intersect) {
    const child = intersect.object;
    const geometry = child.geometry;
    const colorAttr = geometry?.attributes?.color;
    const faceIdAttr = geometry?.attributes?.faceId;

    if (colorAttr && faceIdAttr && intersect.face) {
        // ヒットしたポリゴン頂点からFaceIDを取得
        const vertexIndex = intersect.face.a;
        const fId = Math.round(faceIdAttr.getX(vertexIndex));
        
        // 現在選択中のパレットカラー(HEX)を取得 (例: #ff0000)
        // アプリ内で保持している現在の選択色変数に書き換えてください
        const activeColorHex = colorPicker ? colorPicker.value : "#ff0000"; 
        const tempColor = new THREE.Color(activeColorHex);

        // 該当するFaceIDを持つすべての頂点の色を塗り替える
        const vertexCount = colorAttr.count;
        let updated = false;

        for (let i = 0; i < vertexCount; i++) {
            if (Math.round(faceIdAttr.getX(i)) === fId) {
                colorAttr.setXYZ(i, tempColor.r, tempColor.g, tempColor.b);
                updated = true;
            }
        }

        if (updated) {
            colorAttr.needsUpdate = true;
            
            // 右下のFaceID情報表示ボックスもリアルタイム更新
            if (faceIdLabel) faceIdLabel.innerText = fId;
            if (meshNameLabel) meshNameLabel.innerText = child.name || "Unnamed";
            
            // 💡 必要に応じて、既存のアンドゥ用履歴保存（saveHistory）などをここに挟んでください
        }
    }
}


// ============================================================
// 👑 追加：HTMLのランチャー起動ボタンのイベント設定
// ============================================================
const btnTriggerLauncher = document.getElementById('btn-trigger-launcher');
if (btnTriggerLauncher) {
    btnTriggerLauncher.addEventListener('click', (e) => {
        e.stopPropagation(); // イベントの誤爆防止
        toggleLauncher();
    });
}


// ============================================================
// ⌨️ キーボードショートカット設定 ([ESC] でのトグル・解除 ＆ ランチャー)
// ============================================================
window.addEventListener('keydown', (e) => {
    // いずれかのメモテキストエリアに入力中の場合は、ESCでフォーカスを外す処理を最優先
    if (document.activeElement && document.activeElement.classList.contains('pop-memo-textarea')) {
        if (e.key === 'Escape' || e.code === 'Escape') {
            document.activeElement.blur();
        }
        return;
    }

    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    
    // 👑 【ESCキー】の挙動をスマートに制御
    if (e.key === 'Escape' || e.code === 'Escape') {
        if (isMeasureMode || isMemoMode) {
            // ① 特殊モード（測定やメモ）が起動している場合は、従来通り「モードを解除」
            if (isMeasureMode) toggleMeasureMode(false);
            if (isMemoMode) toggleMemoMode(false);
        } else {
            // ② 何も起動していない通常状態であれば、「ランチャーを起動・閉じる」
            toggleLauncher();
        }
        return;
    }

    // スペースキーでクイックランチャー（従来通り）
    if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        toggleLauncher();
    }
    
    // ランチャーが開いているときの数字キーコマンド
    if (isLauncherOpen) {
        if (e.key === '1' && btnToolMeasure) btnToolMeasure.click();
        if (e.key === '2' && btnToolClipping) btnToolClipping.click();
        if (e.key === '3' && btnToolMemo) btnToolMemo.click();
    }
});

// ランチャー開閉関数（ボタンの文字を状態に合わせて変化させる処理を追加）
function toggleLauncher() {
    isLauncherOpen = !isLauncherOpen;
    if (launcherOverlay) launcherOverlay.classList.toggle('active', isLauncherOpen);
    
    // ランチャーが開いている時はボタンの色を少し変える演出（任意）
    if (btnTriggerLauncher) {
        if (isLauncherOpen) {
            btnTriggerLauncher.style.background = '#10b981'; // 緑色
        } else {
            btnTriggerLauncher.style.background = '#3b82f6'; // 元の青色
        }
    }
}

// ============================================================
// 🖱️ マウスクリックメイン処理（距離測定 ＆ 3D複数配置メモ）
// ============================================================
canvas.addEventListener('mousedown', (e) => {
    if (!isMeasureMode && !isMemoMode) return;
    if (e.button !== 0) return; // 左クリックのみ

    e.stopImmediatePropagation();
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    if (currentModel) {
        
        const intersects = raycaster.intersectObjects(currentModel.children, true);

        // edgeモード時はLineSegmentsを優先、それ以外はMeshのみ
        const activeModeEl = document.querySelector('input[name="selectMode"]:checked');
        const selectMode = activeModeEl ? activeModeEl.value : 'vertex';

        let intersect;
        if (selectMode === 'edge') {
            console.log("セレクトモードがエッジでマウスダウン")
            // edgeLines（LineSegments）を最優先。非表示パーツは除外。
            const edgeHit = intersects.find(hit =>
                hit.object.isLineSegments &&
                hit.object.name === 'edgeLines' &&
                hit.object.parent && hit.object.parent.visible !== false
            );
            if (edgeHit) {
                intersect = edgeHit;
                console.log(intersect,"1")
            } else {
                // edgeLinesにヒットしない場合はMeshにフォールバック
                intersect = intersects.find(hit =>
                    hit.object.isMesh &&
                    hit.object.parent && hit.object.parent.visible !== false
                );
            }
        } else {
            intersect = intersects.find(hit =>
                hit.object.isMesh &&
                hit.object.parent && hit.object.parent.visible !== false
            );
        }
        if (intersect) {
            console.log(intersect)
            if (isMeasureMode) {
                handleMeasureClick(intersect);
            } else if (isMemoMode) {
                // 💡 複数配置可能なメモ生成処理を呼び出し
                createNewMemo(intersect.point.clone());
            }
        }
    }
}, true);


// ------------------------------------------------------------
// ① 距離測定ロジック（変更なし）
// ------------------------------------------------------------
if (btnToolMeasure) {
    btnToolMeasure.addEventListener('click', () => {
        toggleLauncher();
        toggleMeasureMode();
    });
}

////////////////////////////////////////////////////////////
// 🚀 強化版：測定モード時のクリック選択・幾何特性計算処理
////////////////////////////////////////////////////////////
// 1857行目
function handleMeasureClick(intersect) {
    console.log(intersect)
    if (!intersect || (!intersect.object.isMesh && !intersect.object.isLineSegments)) return;
    
    // 現在選択されている選択モードを取得
    const activeModeEl = document.querySelector('input[name="selectMode"]:checked');
    const selectMode = activeModeEl ? activeModeEl.value : 'vertex';
    
    const mesh = intersect.object;
    const geometry = mesh.geometry;
    const positionAttr = geometry.attributes.position;
    
    if (!positionAttr) return;

    // --- ① 【点：頂点スナップ】モード ---
    if (selectMode === 'vertex') {
        const face = intersect.face;
        if (!face) return;
        
        // クリックされた面(Face)の3つの頂点から、最もクリック位置に近い頂点を探索
        const indices = [face.a, face.b, face.c];
        let minDst = Infinity;
        let closestVertex = new THREE.Vector3();
        
        for (let i = 0; i < 3; i++) {
            const v = new THREE.Vector3().fromBufferAttribute(positionAttr, indices[i]);
            v.applyMatrix4(mesh.matrixWorld); // ワールド座標系に変換
            const dst = intersect.point.distanceTo(v);
            if (dst < minDst) {
                minDst = dst;
                closestVertex.copy(v);
            }
        }
        
        // 2点間測定配列へプッシュ
        pushMeasurePoint(closestVertex);
    } 
    
// --- ② 【線：エッジライン】モード ---
    else if (selectMode === 'edge') {

        let p1, p2;

        // ── LineSegments（B-Rep edgeLines）に直接ヒットした場合 ──
        if (intersect.object.isLineSegments) {
            const lineGeo  = intersect.object.geometry;
            const posAttr  = lineGeo.attributes.position;
            const edgeIdAttr = lineGeo.attributes.edgeId;
            //console.log("edgeIdAttr")
            //console.log(edgeIdAttr)

            if (edgeIdAttr) {
                // ── B-Rep edgeId あり：同一エッジの全セグメントを収集してポリラインを再構築 ──
                // ヒットセグメントの頂点インデックスからエッジIDを特定
                const hitVtx = intersect.index;
                const targetId = Math.round(edgeIdAttr.getX(hitVtx));
                console.log("targetId")
                console.log(targetId)
                

                // 同一 edgeId を持つ全頂点をセグメント順に列挙（頂点ペア単位で格納済み）
                const polyPoints = [];
                const vtxCount = posAttr.count;
                for (let i = 0; i < vtxCount; i += 2) {
                    if (Math.round(edgeIdAttr.getX(i)) === targetId) {
                        polyPoints.push(
                            new THREE.Vector3().fromBufferAttribute(posAttr, i)
                                .applyMatrix4(intersect.object.matrixWorld),
                            new THREE.Vector3().fromBufferAttribute(posAttr, i + 1)
                                .applyMatrix4(intersect.object.matrixWorld)
                        );
                    }
                }

                if (polyPoints.length === 0) return;

                // ポリライン全長を計算（各セグメントの長さの総和）
                let totalLength = 0;
                for (let i = 0; i < polyPoints.length; i += 2) {
                    totalLength += polyPoints[i].distanceTo(polyPoints[i + 1]);
                }

                // 始点と終点を取得

                p1 = polyPoints[0];
                p2 = polyPoints[polyPoints.length - 1];

                const chordLength = p1.distanceTo(p2); // 始点・終点間の直線距離
                const deltaX = Math.abs(p2.x - p1.x);
                const deltaY = Math.abs(p2.y - p1.y);
                const deltaZ = Math.abs(p2.z - p1.z);

                // ── 🎯 フィレット（円弧）および完全な円（正円）の幾何学計算 ──
                let calculatedR = null;
                let arcLength = chordLength; 
                let isArc = false;
                let isFullCircle = false; // 完全な円かどうかのフラグ
                let circleCenter = null;  // 中心座標格納用

                // 始点と終点がほぼ同じ位置（例: 0.01mm以下）の場合、閉じている円（正円）とみなす
                if (polyPoints.length >= 4 && chordLength < 0.01) {
                    // 頂点の全座標の平均から簡易的な中心（重心）を求める
                    circleCenter = new THREE.Vector3(0, 0, 0);
                    // 閉じている場合、最後の点は始点と同じなので最後の1点を除いて平均をとる
                    const count = polyPoints.length - 1;
                    for (let i = 0; i < count; i++) {
                        circleCenter.add(polyPoints[i]);
                    }
                    circleCenter.divideScalar(count);

                    // 中心から各頂点までの距離の平均を半径 R とする
                    let totalRadius = 0;
                    for (let i = 0; i < count; i++) {
                        totalRadius += polyPoints[i].distanceTo(circleCenter);
                    }
                    calculatedR = totalRadius / count;

                    // 完全な円の弧長 ＝ 円周 (2 * π * R)
                    arcLength = 2 * Math.PI * calculatedR;
                    isArc = true;
                    isFullCircle = true;

                } else if (polyPoints.length >= 4) {
                    // ── 開いている円弧（フィレット）の計算 ──
                    const midIndex = Math.floor(polyPoints.length / 2);
                    const pMid = polyPoints[midIndex];

                    const v1 = new THREE.Vector3().subVectors(pMid, p1);
                    const v2 = new THREE.Vector3().subVectors(p2, p1);
                    const cross = new THREE.Vector3().crossVectors(v1, v2);

                    if (cross.length() > 0.001) {
                        const len1 = v1.length();
                        const len2 = v2.length();
                        const lenSub = new THREE.Vector3().subVectors(p2, pMid).length();

                        const area4 = 2 * cross.length();
                        if (area4 > 0.001) {
                            calculatedR = (len1 * len2 * lenSub) / area4;

                            // 弦長から中心角 theta を計算
                            const sinHalfTheta = Math.min(1.0, chordLength / (2 * calculatedR));
                            const theta = 2 * Math.asin(sinHalfTheta);
                            arcLength = calculatedR * theta;

                            // 💡 【追加】3点 (p1, pMid, p2) から外接円の中心座標を数学的に計算
                            // 三角形の平面上の外心（外接円の中心）のベクトル公式を使用
                            const a2 = lenSub * lenSub;
                            const b2 = len2 * len2;
                            const c2 = len1 * len1;

                            const w1 = a2 * (b2 + c2 - a2);
                            const w2 = b2 * (c2 + a2 - b2);
                            const w3 = c2 * (a2 + b2 - c2);

                            circleCenter = new THREE.Vector3()
                                .addScaledVector(p1, w1)
                                .addScaledVector(pMid, w2)
                                .addScaledVector(p2, w3)
                                .divideScalar(w1 + w2 + w3);

                            isArc = true;
                        }
                    }
                }

                // ── UIへの出力表示の更新 ──
                if (measureText && measureXyzText) {
                    measureLabel.style.display = 'block';

                    if (isArc && calculatedR !== null) {
                        if (isFullCircle && circleCenter) {
                            // ① 完全な円（正円）の場合の表示
                            measureText.innerHTML = `選択エッジの円周長: <span>${arcLength.toFixed(3)} mm</span>`;
                            measureXyzText.innerHTML = `
                                <span style="color:#2ecc71; font-weight:bold;">【正円検出】 半径: R ${calculatedR.toFixed(3)}</span> (直径 φ: ${(calculatedR * 2).toFixed(3)} mm)<br>
                                <span style="color:#f1c40f;">中心座標: X: ${circleCenter.x.toFixed(3)} | Y: ${circleCenter.y.toFixed(3)} | Z: ${circleCenter.z.toFixed(3)}</span>
                            `;
                        } else {
                            // ② 通常のフィレット円弧の場合の表示（中心座標を追加）
                            measureText.innerHTML = `選択エッジの弧長: <span>${arcLength.toFixed(3)} mm</span>`;
                            
                            let centerCoordsHtml = '';
                            if (circleCenter) {
                                centerCoordsHtml = `<br><span style="color:#f1c40f;">推定中心座標: X: ${circleCenter.x.toFixed(3)} | Y: ${circleCenter.y.toFixed(3)} | Z: ${circleCenter.z.toFixed(3)}</span>`;
                            }

                            measureXyzText.innerHTML = `
                                ΔX: ${deltaX.toFixed(3)} | ΔY: ${deltaY.toFixed(3)} | ΔZ: ${deltaZ.toFixed(3)}<br>
                                <span style="color:#00bcff; font-weight:bold;">【円弧検出】 判定Rサイズ: R ${calculatedR.toFixed(3)}</span> (直径 φ: ${(calculatedR * 2).toFixed(3)} mm)${centerCoordsHtml}
                            `;
                        }
                    } else {
                        // ③ 直線エッジの場合の表示
                        measureText.innerHTML = `選択エッジの長さ(直線): <span>${chordLength.toFixed(3)} mm</span>`;
                        measureXyzText.innerHTML = `ΔX: ${deltaX.toFixed(3)} | ΔY: ${deltaY.toFixed(3)} | ΔZ: ${deltaZ.toFixed(3)}`;
                    }
                }

                // ハイライト：B-Rep ポリライン全体をマーカー＋ラインで描画
                clearMeasureVisuals();
                createMarkerAt(p1);
                createMarkerAt(p2);

                // ポリライン全体をセグメント接続して描画
                const allPts = [];
                for (let i = 0; i < polyPoints.length; i += 2) {
                    allPts.push(polyPoints[i], polyPoints[i + 1]);
                }
                const lineGeo2 = new THREE.BufferGeometry().setFromPoints(allPts);
                const lineMat2 = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2, depthTest: false });
                const measurePolyLine = new THREE.LineSegments(lineGeo2, lineMat2);
                scene.add(measurePolyLine);
                measureMarkers.push(measurePolyLine);
                return; // 以降の共通処理はスキップ

            } else {
                // edgeId なし（フォールバック EdgesGeometry）：従来通り1セグメントの両端
                let i0, i1;
                if (lineGeo.index) {
                    i0 = lineGeo.index.getX(intersect.faceIndex * 2);
                    i1 = lineGeo.index.getX(intersect.faceIndex * 2 + 1);
                } else {
                    i0 = intersect.faceIndex * 2;
                    i1 = intersect.faceIndex * 2 + 1;
                }
                if (i0 >= posAttr.count || i1 >= posAttr.count) {
                    p1 = intersect.point.clone();
                    p2 = intersect.point.clone();
                } else {
                    p1 = new THREE.Vector3().fromBufferAttribute(posAttr, i0)
                             .applyMatrix4(intersect.object.matrixWorld);
                    p2 = new THREE.Vector3().fromBufferAttribute(posAttr, i1)
                             .applyMatrix4(intersect.object.matrixWorld);
                }
            }

        // ── フォールバック：メッシュ面の三角形辺から最近傍エッジを選ぶ ──
        } else {
            const face = intersect.face;
            if (!face) return;

            const vA = new THREE.Vector3().fromBufferAttribute(positionAttr, face.a).applyMatrix4(mesh.matrixWorld);
            const vB = new THREE.Vector3().fromBufferAttribute(positionAttr, face.b).applyMatrix4(mesh.matrixWorld);
            const vC = new THREE.Vector3().fromBufferAttribute(positionAttr, face.c).applyMatrix4(mesh.matrixWorld);

            const edges = [
                { p1: vA, p2: vB },
                { p1: vB, p2: vC },
                { p1: vC, p2: vA }
            ];

            let minEdgeDist = Infinity;
            let targetEdge = edges[0];

            edges.forEach(edge => {
                const line = new THREE.Line3(edge.p1, edge.p2);
                const closestPointOnLine = new THREE.Vector3();
                line.closestPointToPoint(intersect.point, true, closestPointOnLine);
                const d = intersect.point.distanceTo(closestPointOnLine);
                if (d < minEdgeDist) {
                    minEdgeDist = d;
                    targetEdge = edge;
                }
            });

            p1 = targetEdge.p1;
            p2 = targetEdge.p2;
        }

        // ── 共通（フォールバック用）：長さ・差分の計算と表示 ──
        const edgeLength = p1.distanceTo(p2);
        const deltaX = Math.abs(p2.x - p1.x);
        const deltaY = Math.abs(p2.y - p1.y);
        const deltaZ = Math.abs(p2.z - p1.z);

        if (measureText && measureXyzText) {
            measureLabel.style.display = 'block';
            measureText.innerHTML = `選択エッジの長さ: <span>${edgeLength.toFixed(3)} mm</span>`;
            measureXyzText.innerHTML = `
                ΔX: ${deltaX.toFixed(3)} | ΔY: ${deltaY.toFixed(3)} | ΔZ: ${deltaZ.toFixed(3)}<br>
                <span style="color:#778;">(マージンボックス)</span><br>
                マージンボックス XYZ: [${deltaX.toFixed(2)}, ${deltaY.toFixed(2)}, ${deltaZ.toFixed(2)}]
            `;
        }

        clearMeasureVisuals();
        createMarkerAt(p1);
        createMarkerAt(p2);
        drawMeasureLine(p1, p2);
    }
    // --- ③ 【面上の点：任意点】モード ---
    else if (selectMode === 'face-point') {
        // 今まで通りの2点間測定表示
        pushMeasurePoint(intersect.point.clone());
    } 
    
    // --- ④ 【パーツ：3Dソリッド】モード ---
    else if (selectMode === 'part') {
        // 所属するソリッドオブジェクトを丸ごと計算
        // OpenCascadeから体積と表面積を取得するために、ジオメトリ全体のバウンディングボックスおよび擬似積分で算出、
        // またはMeshからThree.js側で高精度に算出した体積・表面積を表示します。
        
        let surfaceArea = 0;
        let volume = 0;
        
        const indexAttr = geometry.index;
        const pos = geometry.attributes.position;
        
        if (indexAttr) {
            for (let i = 0; i < indexAttr.count; i += 3) {
                const iA = indexAttr.getX(i);
                const iB = indexAttr.getX(i+1);
                const iC = indexAttr.getX(i+2);
                
                const vA = new THREE.Vector3().fromBufferAttribute(pos, iA);
                const vB = new THREE.Vector3().fromBufferAttribute(pos, iB);
                const vC = new THREE.Vector3().fromBufferAttribute(pos, iC);
                
                // 表面積：各三角形の面積の総和
                const triangle = new THREE.Triangle(vA, vB, vC);
                surfaceArea += triangle.getArea();
                
                // 体積：原点を基準とした四面体符号付き体積の総和
                volume += vA.dot(vB.cross(vC)) / 6.0;
                
            }
        }
        
        // スケール成分を考慮 (1.0倍想定ですが実座標系に補正)
        volume = Math.abs(volume);
        
        if (measureText && measureXyzText) {
            measureLabel.style.display = 'block';
            measureText.innerHTML = `選択パーツ: <span>${mesh.parent ? mesh.parent.name : mesh.name}</span>`;
            measureXyzText.innerHTML = `
                表面積: <span>${surfaceArea.toLocaleString(undefined, {maximumFractionDigits:2})} mm²</span><br>
                体積: <span>${volume.toLocaleString(undefined, {maximumFractionDigits:2})} mm³</span>
            `;
        }
        
        // パーツ全体をハイライト表示
        clearMeasureVisuals();
        highlightWholePart(mesh);
    }
}

// 既存の2点登録処理との連携
function pushMeasurePoint(pt) {
    measurePoints.push(pt);
    createMarkerAt(pt);
    
    if (measurePoints.length === 2) {
        const p1 = measurePoints[0];
        const p2 = measurePoints[1];
        const dist = p1.distanceTo(p2);
        
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);
        const dz = Math.abs(p2.z - p1.z);
        
        if (measureText && measureXyzText) {
            measureLabel.style.display = 'block';
            measureText.innerHTML = `2点間直線距離: <span>${dist.toFixed(3)} mm</span>`;
            measureXyzText.innerHTML = `ΔX: ${dx.toFixed(3)} | ΔY: ${dy.toFixed(3)} | ΔZ: ${dz.toFixed(3)}`;
        }
        
        drawMeasureLine(p1, p2);
        measurePoints = []; // 次の測定用にリセット
    }
}

// 補助：マーカー作成（ズームしても常に一定サイズ）
function createMarkerAt(pos) {
    // 1. 点（1頂点）のジオメトリを作成
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([pos.x, pos.y, pos.z], 3));

    // 2. マテリアルの設定
    const mat = new THREE.PointsMaterial({
        color: 0x00ffcc,
        size: 10,               // 🚀 画面上での表示サイズ（ピクセル単位）。お好みで調整してください。
        sizeAttenuation: false, // 👑 これを false にすることで、拡大縮小してもサイズを一定に保ちます
        depthTest: false        // 既存のコード通り、モデルに隠れず最前面に描画
    });

    // 3. メッシュの代わりに Points オブジェクトを作成して追加
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    
    // 既存の管理用配列に追加（一括削除などの処理はそのまま動作します）
    measureMarkers.push(points);
}


// 補助：測定ライン描画
function drawMeasureLine(p1, p2) {
    if (measureVisualLine) scene.remove(measureVisualLine);
    const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 2, depthTest: false });
    measureVisualLine = new THREE.Line(geo, mat);
    scene.add(measureVisualLine);
}

// 補助：パーツ全体のハイライト表示
function highlightWholePart(mesh) {
    const cloneGeom = mesh.geometry.clone();
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.3, wireframe: false });
    const highMesh = new THREE.Mesh(cloneGeom, mat);
    highMesh.position.copy(mesh.position);
    highMesh.rotation.copy(mesh.rotation);
    highMesh.scale.copy(mesh.scale).multiplyScalar(1.001);
    scene.add(highMesh);
    measureMarkers.push(highMesh); // クリーニング対象に入れる
}

// 補助：測定表示のクリア
function clearMeasureVisuals() {
    measureMarkers.forEach(m => {
        scene.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
    });
    measureMarkers = [];
    if (measureVisualLine) {
        scene.remove(measureVisualLine);
        measureVisualLine.geometry.dispose();
        measureVisualLine.material.dispose();
        measureVisualLine = null;
    }
}

// 既存のクリア処理をオーバーライド・拡張
function clearMeasure() {
    clearMeasureVisuals();
    clearEdgeHoverHighlight();
    measurePoints = [];
    if (measureText) measureText.innerText = '---';
    if (measureXyzText) measureXyzText.innerText = '';
}

// ============================================================
// エッジホバーハイライト（測定モード・edge選択モード専用）
// B-Rep edgeId 属性を使い、同一エッジの全セグメントをまとめてハイライト
// ============================================================

function clearEdgeHoverHighlight() {
    if (hoveredEdgeHighlight) {
        scene.remove(hoveredEdgeHighlight);
        hoveredEdgeHighlight.geometry.dispose();
        hoveredEdgeHighlight.material.dispose();
        hoveredEdgeHighlight = null;
    }
    hoveredEdgeId = -1;
}

function updateEdgeHoverHighlight(clientX, clientY) {
    if (!currentModel) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x =  ((clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((clientY - rect.top)  / rect.height) * 2 + 1;

    camera.updateProjectionMatrix();
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(currentModel.children, true);
    const edgeHit = intersects.find(hit =>
        hit.object.isLineSegments &&
        hit.object.name === 'edgeLines' &&
        hit.object.parent && hit.object.parent.visible !== false
    );

    if (!edgeHit) { clearEdgeHoverHighlight(); return; }

    const lineGeo    = edgeHit.object.geometry;
    const posAttr    = lineGeo.attributes.position;
    const edgeIdAttr = lineGeo.attributes.edgeId;
    const hitIndex   = edgeHit.index; // 💡 ヒットしたセグメントの頂点インデックスを取得

    let targetEdgeId;
    if (edgeIdAttr && hitIndex !== undefined) {
        // LineSegments のインデックス（hitIndex）から直接 edgeId を取得
        targetEdgeId = Math.round(edgeIdAttr.getX(hitIndex));
    } else {
        // edgeId 属性がない場合のフォールバック（必要に応じて）
        targetEdgeId = hitIndex !== undefined ? Math.floor(hitIndex / 2) : -1;
    }

    if (targetEdgeId === hoveredEdgeId) return;
    clearEdgeHoverHighlight();
    hoveredEdgeId = targetEdgeId;

    const hlPoints = [];
    if (edgeIdAttr) {
        const vtxCount = posAttr.count;
        for (let i = 0; i < vtxCount; i += 2) {
            if (Math.round(edgeIdAttr.getX(i)) === targetEdgeId) {
                hlPoints.push(
                    new THREE.Vector3().fromBufferAttribute(posAttr, i)
                        .applyMatrix4(edgeHit.object.matrixWorld),
                    new THREE.Vector3().fromBufferAttribute(posAttr, i + 1)
                        .applyMatrix4(edgeHit.object.matrixWorld)
                );
            }
        }
    } else {
        const i0 = edgeHit.faceIndex * 2;
        hlPoints.push(
            new THREE.Vector3().fromBufferAttribute(posAttr, i0)
                .applyMatrix4(edgeHit.object.matrixWorld),
            new THREE.Vector3().fromBufferAttribute(posAttr, i0 + 1)
                .applyMatrix4(edgeHit.object.matrixWorld)
        );
    }

    if (hlPoints.length === 0) return;

    const hlGeo = new THREE.BufferGeometry().setFromPoints(hlPoints);
    const hlMat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3, depthTest: false });
    hoveredEdgeHighlight = new THREE.LineSegments(hlGeo, hlMat);
    scene.add(hoveredEdgeHighlight);
}
// ------------------------------------------------------------
// 👑 ② 複数配置 ＆ 永続表示対応型 3D追従メモ帳ロジック
// ------------------------------------------------------------
if (btnToolMemo) {
    btnToolMemo.addEventListener('click', () => {
        toggleLauncher();
        toggleMemoMode();
    });
}

// 💡 新しいメモオブジェクトとHTML要素を完全に動的生成する
function createNewMemo(point) {
    const memoId = 'memo_' + Date.now();

    // 1. 3D空間上のピン（黄色の球体）を生成して配置
    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1.0, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xf1c40f, depthTest: true })
    );
    marker.position.copy(point);
    marker.visible = false;
    scene.add(marker);

    // 2. HTMLのミニウィンドウ要素を動的に構築
    const memoEl = document.createElement('div');
    memoEl.id = memoId;
    memoEl.style.cssText = `
        position: absolute; 
        background: rgba(20, 20, 30, 0.95); 
        border: 1px solid #f1c40f; 
        border-radius: 8px; 
        padding: 8px; 
        width: 220px; 
        z-index: 500; 
        box-shadow: 0 10px 25px rgba(0,0,0,0.6);
        display: block;
    `;

    // ウィンドウヘッダー（タイトルと削除ボタン）
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; border-bottom: 1px solid #444; padding-bottom: 2px;';
    
    const title = document.createElement('span');
    title.innerText = `📝 メモ #${memoList.length + 1}`;
    title.style.cssText = 'color: #f1c40f; font-size: 11px; font-weight: bold; pointer-events: none;';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.style.cssText = 'background: transparent; color: #888; border: none; cursor: pointer; font-size: 14px; padding: 0 4px; outline: none;';
    
    // 削除ボタンクリック時の処理
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeMemo(memoId);
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    // テキスト入力エリア
    const textarea = document.createElement('textarea');
    textarea.className = 'pop-memo-textarea';
    textarea.style.cssText = 'width: 100%; height: 70px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 4px; resize: none; font-size: 12px; outline: none;';
    textarea.placeholder = "メモを入力... [ESCで確定]";

    // 入力時に即座にデータ（メモリ内）に反映するイベント
    textarea.addEventListener('input', () => {
        const targetMemo = memoList.find(m => m.id === memoId);
        if (targetMemo) targetMemo.text = textarea.value;
    });

    memoEl.appendChild(header);
    memoEl.appendChild(textarea);

    // ドキュメントに追加
    document.body.appendChild(memoEl);

    // 3. データ配列に保存
    const newMemoObj = {
        id: memoId,
        point: point,
        text: '',
        marker: marker,
        element: memoEl
    };
    memoList.push(newMemoObj);

    // 位置を即時計算してフォーカス
    updateSingleMemoPosition(newMemoObj);
    textarea.focus();
}

// 💡 JSONインポート時にデータから直接メモオブジェクトを安全に復元する関数
function restoreMemoFromData(point, text) {
    const memoId = 'memo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // 1. 3D空間上のピン（黄色の球体）を生成
    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1.0, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xf1c40f, depthTest: true })
    );
    marker.position.copy(point);
    scene.add(marker);

    // 2. HTMLのミニウィンドウ要素を生成
    const memoEl = document.createElement('div');
    memoEl.id = memoId;
    memoEl.style.cssText = `
        position: absolute; 
        background: rgba(20, 20, 30, 0.95); 
        border: 1px solid #f1c40f; 
        border-radius: 8px; 
        padding: 8px; 
        width: 220px; 
        z-index: 500; 
        box-shadow: 0 10px 25px rgba(0,0,0,0.6);
        display: none; /* デフォルトは一旦非表示、モードの状態に依存させる */
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; border-bottom: 1px solid #444; padding-bottom: 2px;';
    
    const title = document.createElement('span');
    title.innerText = `📝 メモ #${memoList.length + 1}`;
    title.style.cssText = 'color: #f1c40f; font-size: 11px; font-weight: bold; pointer-events: none;';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerText = '×';
    closeBtn.style.cssText = 'background: transparent; color: #888; border: none; cursor: pointer; font-size: 14px; padding: 0 4px; outline: none;';
    
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeMemo(memoId);
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const textarea = document.createElement('textarea');
    textarea.className = 'pop-memo-textarea';
    textarea.style.cssText = 'width: 100%; height: 70px; background: #111; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 4px; resize: none; font-size: 12px; outline: none;';
    textarea.placeholder = "メモを入力... [ESCで確定]";
    textarea.value = text; // 💡 復元されたテキストを注入

    textarea.addEventListener('input', () => {
        const targetMemo = memoList.find(m => m.id === memoId);
        if (targetMemo) targetMemo.text = textarea.value;
    });

    memoEl.appendChild(header);
    memoEl.appendChild(textarea);
    document.body.appendChild(memoEl);

    // 3. リストにプッシュ
    const restoredMemoObj = {
        id: memoId,
        point: point,
        text: text,
        marker: marker,
        element: memoEl
    };
    memoList.push(restoredMemoObj);
}


// 特定のメモを完全削除する
function removeMemo(memoId) {
    const index = memoList.findIndex(m => m.id === memoId);
    if (index === -1) return;

    const memo = memoList[index];

    // 3Dピンの削除
    if (memo.marker) {
        scene.remove(memo.marker);
        if (memo.marker.geometry) memo.marker.geometry.dispose();
        if (memo.marker.material) memo.marker.material.dispose();
    }
    // HTML要素の削除
    if (memo.element && memo.element.parentNode) {
        memo.element.parentNode.removeChild(memo.element);
    }

    memoList.splice(index, 1);

    // ラベルの番号（#1, #2...）を綺麗に振り直す
    memoList.forEach((m, idx) => {
        const titleSpan = m.element.querySelector('span');
        if (titleSpan) titleSpan.innerText = `📝 メモ #${idx + 1}`;
    });
}

// 単一のメモウィンドウの位置を3D空間の座標から2D画面へマッピングする
function updateSingleMemoPosition(memo) {
    if (!memo.point || !memo.element || memo.element.style.display === 'none') return;

    const wp = memo.point.clone();
    wp.project(camera); 

    const rect = canvas.getBoundingClientRect();
    const x = (wp.x * .5 + .5) * rect.width + rect.left;
    const y = (-(wp.y * .5) + .5) * rect.height + rect.top;

    // クリックした3D点から少し右上へオフセットして表示
    memo.element.style.left = `${x + 12}px`;
    memo.element.style.top = `${y - 40}px`;
}

// 新しく別のSTEPファイルが読み込まれた時にすべてのメモを安全に一掃するクリーンアップ
function clearAllMemos() {
    const ids = memoList.map(m => m.id);
    ids.forEach(id => removeMemo(id));
    memoList = [];
}


// ------------------------------------------------------------
// ③ 高機能断面表示ロジック（変更なし）
// ------------------------------------------------------------
if (btnToolClipping) {
    btnToolClipping.addEventListener('click', () => {
        if (!currentModel) {
            alert('モデルが読み込まれていません。');
            toggleLauncher();
            return;
        }
        toggleLauncher();
        isClippingMode = !isClippingMode;

        if (isClippingMode) {
            if (btnToolClipping) btnToolClipping.style.background = '#b45309';
            if (mainClippingPanel) mainClippingPanel.style.display = 'block';

            const box = new THREE.Box3().setFromObject(currentModel);
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);

            if (clipSliderDist) {
                clipSliderDist.min = -maxDim * 1.5;
                clipSliderDist.max = maxDim * 1.5;
                clipSliderDist.step = (maxDim / 200).toFixed(2);
                clipSliderDist.value = 0;
            }
            if (clipSliderAngle) clipSliderAngle.value = 0;
            
            applyClippingTransform();
            updateModelClipping(true);
        } else {
            if (btnToolClipping) btnToolClipping.style.background = '';
            if (mainClippingPanel) mainClippingPanel.style.display = 'none';
            updateModelClipping(false);
        }
    });
}

const axisButtons = [clipAxisX, clipAxisY, clipAxisZ];
axisButtons.forEach(btn => {
    if (btn) {
        btn.addEventListener('click', (e) => {
            axisButtons.forEach(b => { if (b) b.classList.remove('active-axis'); });
            e.target.classList.add('active-axis');
            currentClipAxis = e.target.innerText.replace('軸', '');
            applyClippingTransform();
        });
    }
});

if (clipSliderDist)  clipSliderDist.addEventListener('input', applyClippingTransform);
if (clipSliderAngle) clipSliderAngle.addEventListener('input', applyClippingTransform);

function applyClippingTransform() {
    if (!currentModel) return;

    const offsetDist = clipSliderDist ? parseFloat(clipSliderDist.value) : 0;
    const angleDeg = clipSliderAngle ? parseFloat(clipSliderAngle.value) : 0;
    const angleRad = (angleDeg * Math.PI) / 180;

    let normal = new THREE.Vector3();
    if (currentClipAxis === 'X') {
        normal.set(-Math.cos(angleRad), 0, -Math.sin(angleRad));
    } else if (currentClipAxis === 'Y') {
        normal.set(0, -Math.cos(angleRad), -Math.sin(angleRad));
    } else {
        normal.set(-Math.sin(angleRad), -Math.cos(angleRad), 0);
    }
    normal.normalize();

    const box = new THREE.Box3().setFromObject(currentModel);
    const center = box.getCenter(new THREE.Vector3());

    localPlane.normal.copy(normal);
    localPlane.constant = center.dot(normal) + offsetDist;

    if (clipDistVal)  clipDistVal.innerText = `${offsetDist >= 0 ? '+' : ''}${offsetDist.toFixed(1)} mm`;
    if (clipAngleVal) clipAngleVal.innerText = `${angleDeg}°`;
}

function updateModelClipping(enable) {
    if (!currentModel) return;
    currentModel.traverse((child) => {
        if (child.isMesh) {
            child.material.clippingPlanes = enable ? [localPlane] : [];
            child.material.clipShadows = enable;
            child.material.needsUpdate = true;
        }
    });
}


// 断面リセットボタンのイベント処理
if (clipResetBtn) {
    clipResetBtn.addEventListener('click', () => {
        // 1. スライダーの値を強制的に 0 に変更
        if (clipSliderDist)  clipSliderDist.value = 0;
        if (clipSliderAngle) clipSliderAngle.value = 0;

        // 2. ★【追加・重要】イベントを強制的に発火させて数値表示テキストの書き換えと再計算を同期させる
        if (clipSliderDist)  clipSliderDist.dispatchEvent(new Event('input'));
        if (clipSliderAngle) clipSliderAngle.dispatchEvent(new Event('input'));

        // 3. 断面プレーンの更新関数を実行して再計算・反映
        if (typeof updatePlaneFromSliders === 'function') {
            updatePlaneFromSliders();
        } else if (typeof updatePlane === 'function') {
            updatePlane();
        }
    });
}

// ============================================================
// 📊 メモCSV一括エクスポート
// ============================================================
(function initMemoExport() {
    const btnExportCsv = document.getElementById('btn-export-memo-csv');
    if (!btnExportCsv) return;

    btnExportCsv.addEventListener('click', () => {
        // 全体メモ（塗装・モデルメモのtextarea）を取得
        const globalMemoEl = document.getElementById('memo-textarea');
        const globalMemoText = globalMemoEl ? globalMemoEl.value.trim() : '';

        // CSVヘッダー
        const rows = [
            ['種別', 'メモ番号', '3D位置 X', '3D位置 Y', '3D位置 Z', '内容']
        ];

        // 3D位置メモを追加
        memoList.forEach((memo, idx) => {
            const x = memo.point ? memo.point.x.toFixed(3) : '';
            const y = memo.point ? memo.point.y.toFixed(3) : '';
            const z = memo.point ? memo.point.z.toFixed(3) : '';
            rows.push(['3D位置メモ', `#${idx + 1}`, x, y, z, memo.text || '']);
        });

        // 全体メモを追加（内容がある場合）
        if (globalMemoText) {
            rows.push(['全体メモ', '—', '', '', '', globalMemoText]);
        }

        // CSV文字列に変換（フィールドをダブルクォートでエスケープ）
        const csvContent = rows.map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\r\n');

        // BOM付きUTF-8でダウンロード（Excelで文字化けしないよう）
        const bom = '\uFEFF';
        const blob = new Blob([bom + csvContent], { type: 'text/csv; charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
        const filename = `memo_export_${timestamp}.csv`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
})();

////////////////////////////////////////////////////////////
// Animate (👑 毎フレームのループ処理で「すべての表示中メモ」を3D追従)
////////////////////////////////////////////////////////////

(function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // 💡 メモモードがONの時は、配置されているすべてのミニウィンドウをカメラの動きに合わせて追従させる
    if (isMemoMode) {
        memoList.forEach(memo => updateSingleMemoPosition(memo));
    }

    renderer.render(scene, camera);
})();
