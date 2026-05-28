# STEP Face Painter

3D CADの標準フォーマットであるSTEPファイル（.stp / .step）をブラウザ上で読み込み、3Dモデルの「面（Face）」に対して直感的に色を塗ることができるWebアプリケーションです。

本ツールは、インターネット環境がない工場の共用PCやスタンドアロン環境でも快適に動作するよう、**完全オフライン対応**に特化して設計されています。

## 🌐 オンラインページ（PWA対応）

以下のURLから今すぐブラウザ上で利用可能です。
**一度アクセスしてページの読み込みが完了すれば、その後はインターネットを切断した完全オフライン環境でもそのまま使用できます。**

👉 [STEP Face Painter を開く](https://crowclae.github.io/STEP-Face-Painter/)

---

## 主な特徴

- **キャッシュによるオフライン動作**: オンラインページ（GitHub Pages）に一度アクセスすれば、Service Workerの機能により、次回からはネット環境がなくてもブラウザからそのまま起動・利用できます。
- **ローカル完結（安全なセキュリティ）**: 読み込んだSTEPデータは外部のサーバーに一切送信されず、ブラウザのメモリ内だけで完全に処理されます。機密性の高い設計データでも安心して現場で広げられます。
- **摩擦ゼロの操作感**: 面倒なインストール、ユーザー登録、初期設定は一切不要です。
- **正確なB-rep処理**: WebAssemblyベースの強固な3D CADカーネル（OpenCascade.js）を採用し、ポリゴン変換による劣化のない正確な面情報を保持します。

## 使い方（リポジトリをダウンロードして利用する場合）

ネットワーク制限等により上記URLにアクセスできない環境では、本リポジトリを丸ごとダウンロードしてローカルで動かすことも可能です。必要なライブラリはすべて同梱されています。

1. 本リポジトリをダウンロード、またはクローン（`git clone`）します。
2. フォルダ内にある `index.html` をGoogle Chromeなどのブラウザで開きます。
3. STEPファイルを画面にドラッグ＆ドロップして作業を開始してください。

*※ブラウザのセキュリティ制限（WebAssembly/SharedArrayBufferの制約）により、ローカルファイル（`file://`）のままでは実行に問題が生じる場合があります。その場合は、簡易的なローカルサーバー（Pythonの `python -m http.server` など）を経由して `localhost` で開くか、上記のオンラインページを一度読み込ませてからオフラインで使用することをお勧めします。*

## ライセンス (License)

### 本アプリケーションのコード
本リポジトリに含まれる、開発者が作成したオリジナルのコード（`index.html`, `main.js`等）は **MIT License** のもとで公開されています。商用利用・改変・再配布が自由に行えます。詳細はルートディレクトリの `LICENSE` ファイルを参照してください。

### サードパーティ・ライブラリ (Third-Party Licenses)
完全オフライン動作を実現するため、`libs/` ディレクトリ内に以下のオープンソース・ライブラリのバイナリを同梱しています。それぞれのライセンス条文は、各フォルダ内の `LICENSE` ファイルをご確認ください。

- **OpenCascade.js (opencascade.full.js / .wasm)**
  - 権利元: Copyright (c) donalffons / Open CASCADE SAS
  - ライセンス: GNU Lesser General Public License (LGPL) v2.1
  - 用途: ブラウザ上でのSTEPファイル（B-rep構造）のパースおよび幾何解析

- **Three.js (three.module.js / OrbitControls.js)**
  - 権利元: Copyright (c) 2010-2026 three.js authors
  - ライセンス: MIT License
  - 用途: WebGLを用いた3Dモデルの描画およびカメラ操作

- **coi-serviceworker.js**
  - 権利元: Guido Zuidhof
  - ライセンス: MIT License (コード内に明記あり)
  - 用途: SharedArrayBufferのセキュリティ制限を回避し、WebAssemblyを正常に動作させるためのスクリプト
---
Developed by [crow]
