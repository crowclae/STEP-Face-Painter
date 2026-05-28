# STEP Face Painter

[日本語]
3D CADの標準フォーマットであるSTEPファイル（.stp / .step）をブラウザ上で読み込み、3Dモデルの「面（Face）」に対して直感的に色を塗ることができるWebアプリケーションです。本ツールは、インターネット環境がない工場の共用PCやスタンドアロン環境でも快適に動作するよう、**完全オフライン対応**に特化して設計されています。

[English]
A web application that allows you to load STEP files (.stp / .step), the standard 3D CAD format, directly in your browser and intuitively color the faces of 3D models. This tool is specifically designed for **complete offline use**, ensuring smooth operation even on shared computers in factories or standalone environments without internet access.

## 🌐 オンラインページ（PWA対応） / Online Page (PWA Supported)

[日本語]
以下のURLから今すぐブラウザ上で利用可能です。
**一度アクセスしてページの読み込みが完了すれば、その後はインターネットを切断した完全オフライン環境でもそのまま使用できます。**

👉 [STEP Face Painter を開く](https://crowclae.github.io/STEP-Face-Painter/)

[English]
Available to use right now in your browser via the URL below.
**Once you access the page and the initial loading is complete, you can continue to use it in a completely offline environment even after disconnecting from the internet.**

👉 [Open STEP Face Painter](https://crowclae.github.io/STEP-Face-Painter/)

---

## 主な特徴 / Key Features

- **キャッシュによるオフライン動作 / Offline operation via caching**
  - [日本語] オンラインページ（GitHub Pages）に一度アクセスすれば、Service Workerの機能により、次回からはネット環境がなくてもブラウザからそのまま起動・利用できます。
  - [English] Once you visit the online page (GitHub Pages), the Service Worker feature allows you to launch and use the application directly from your browser without an internet connection thereafter.
- **ローカル完結（安全なセキュリティ） / Local execution (Secure)**
  - [日本語] 読み込んだSTEPデータは外部のサーバーに一切送信されず、ブラウザのメモリ内だけで完全に処理されます。機密性の高い設計データでも安心して現場で広げられます。
  - [English] Loaded STEP data is never transmitted to external servers and is processed entirely within the browser's memory. You can safely handle highly confidential design data on-site.
- **摩擦ゼロの操作感 / Zero-friction user experience**
  - [日本語] 面倒なインストール、ユーザー登録、初期設定は一切不要です。
  - [English] No tedious installations, user registrations, or initial setups are required at all.
- **正確なB-rep処理 / Accurate B-rep processing**
  - [日本語] WebAssemblyベースの強固な3D CADカーネル（OpenCascade.js）を採用し、ポリゴン変換による劣化のない正確な面情報を保持します。
  - [English] Employs a robust WebAssembly-based 3D CAD kernel (OpenCascade.js) to maintain accurate face information without the geometric degradation associated with polygon conversion.

## 使い方（リポジトリをダウンロードして利用する場合） / How to Use (When Downloading the Repository)

[日本語]
ネットワーク制限等により上記URLにアクセスできない環境では、本リポジトリを丸ごとダウンロードしてローカルで動かすことも可能です。必要なライブラリはすべて同梱されています。

1. 本リポジトリをダウンロード、またはクローン（`git clone`）します。
2. フォルダ内にある `index.html` をGoogle Chromeなどのブラウザで開きます。
3. STEPファイルを画面にドラッグ＆ドロップして作業を開始してください。

*※ブラウザのセキュリティ制限（WebAssembly/SharedArrayBufferの制約）により、ローカルファイル（`file://`）のままでは実行に問題が生じる場合があります。その場合は、簡易的なローカルサーバー（Pythonの `python -m http.server` など）を経由して `localhost` で開くか、上記のオンラインページを一度読み込ませてからオフラインで使用することをお勧めします。*

[English]
In environments where you cannot access the URL above due to network restrictions, you can download the entire repository and run it locally. All necessary libraries are bundled within the package.

1. Download or clone this repository (`git clone`).
2. Open `index.html` in a web browser such as Google Chrome.
3. Drag and drop your STEP file onto the screen to start working.

*Note: Due to browser security restrictions regarding WebAssembly and SharedArrayBuffer, running the application directly via local files (`file://`) may cause issues. In such cases, please run a simple local server (e.g., `python -m http.server` in Python) and access it via `localhost`, or load the online page mentioned above once to enable subsequent offline use.*

## ライセンス / License

### 本アプリケーションのコード / Application Code
[日本語] 本リポジトリに含まれる、開発者が作成したオリジナルのコード（`index.html`, `main.js`等）は **MIT License** のもとで公開されています。商用利用・改変・再配布が自由に行えます。詳細はルートディレクトリの `LICENSE` ファイルを参照してください。

[English] The original code included in this repository (such as `index.html`, `main.js`, etc.) created by the developer is open-sourced under the **MIT License**. Commercial use, modification, and redistribution are freely permitted. For details, please refer to the `LICENSE` file in the root directory.

### サードパーティ・ライブラリ / Third-Party Licenses
[日本語] 完全オフライン動作を実現するため、`libs/` ディレクトリ内に以下のオープンソース・ライブラリのバイナリを同梱しています。それぞれのライセンス条文は、各フォルダ内の `LICENSE` ファイルをご確認ください。

[English] To enable complete offline operation, the binaries of the following open-source libraries are bundled within the `libs/` directory. Please check the respective `LICENSE` files inside each folder for their full license terms.

- **OpenCascade.js (opencascade.full.js / .wasm)**
  - 権利元 / Credits: Copyright (c) donalffons / Open CASCADE SAS
  - ライセンス / License: GNU Lesser General Public License (LGPL) v2.1
  - 用途 / Purpose: [JA] ブラウザ上でのSTEPファイル（B-rep構造）のパースおよび幾何解析 / [EN] Parsing and geometric analysis of STEP files (B-rep structure) in the browser.

- **Three.js (three.module.js / OrbitControls.js)**
  - 権利元 / Credits: Copyright (c) 2010-2026 three.js authors
  - ライセンス / License: MIT License
  - 用途 / Purpose: [JA] WebGLを用いた3Dモデルの描画およびカメラ操作 / [EN] 3D rendering and camera controls using WebGL.

- **coi-serviceworker.js**
  - 権利元 / Credits: Guido Zuidhof
  - ライセンス / License: MIT License (コード内に明記あり / Stated in the code)
  - 用途 / Purpose: [JA] SharedArrayBufferのセキュリティ制限を回避し、WebAssemblyを正常に動作させるためのスクリプト / [EN] Bypassing browser security restrictions (SharedArrayBuffer/COOP/COEP) to allow WebAssembly to function correctly.

---
Developed by [crow]
