# MDX パイプライン アーキテクチャ

> Revolution の現行版 AI 記事生成パイプライン（MDX ベース）の全体像をまとめたドキュメントです。
> WordPress 版（レガシー）の構成は [`ARCH-project-overview.md`](./ARCH-project-overview.md) に残されていますが、現行のシステムは本ドキュメントを参照してください。

## 目次

- [パイプライン概要図](#パイプライン概要図)
- [詳細パイプラインフロー](#詳細パイプラインフロー)
- [サービス依存関係図](#サービス依存関係図)
- [YAML テンプレート モジュール構造](#yaml-テンプレート-モジュール構造)
- [マルチプロバイダー切り替え](#マルチプロバイダー切り替え)

---

## パイプライン概要図

現行 AI Writer は **RSS / URL → 9 ステップのパイプライン → MDX ファイル → GitHub PR** という流れで動作します。

```mermaid
flowchart TB
    subgraph Input["📥 入力"]
        RSS[("RSS フィード")]
        URL["記事 URL"]
    end

    subgraph Pipeline["🔄 MDX パイプライン (9 Steps)"]
        direction TB
        S0["Step 0.5<br/>記事選別"]
        S1["Step 1<br/>情報抽出"]
        S2["Step 2<br/>Slug 解決"]
        S3["Step 3<br/>重複チェック"]
        S4["Step 4<br/>メタデータ生成"]
        S45["Step 4.5<br/>タイトル生成"]
        S5["Step 5<br/>MDX 生成"]
        S6["Step 6<br/>GitHub PR 作成"]
        S7["Step 7<br/>ステータス更新"]

        S0 --> S1 --> S2 --> S3 --> S4 --> S45 --> S5 --> S6 --> S7
    end

    subgraph External["🌐 外部サービス"]
        AI["AI Provider<br/>(Claude/Gemini/OpenAI)"]
        FS[("Firestore<br/>イベント管理")]
        GH["GitHub API<br/>PR 作成"]
        YAML["YAML テンプレート<br/>(モジュール化)"]
    end

    subgraph Output["📤 出力"]
        MDX["MDX ファイル"]
        PR["GitHub PR"]
    end

    RSS --> S0
    URL --> S0
    S0 <--> AI
    S1 <--> AI
    S2 <--> YAML
    S3 <--> FS
    S4 <--> AI
    S45 <--> AI
    S45 <--> YAML
    S6 --> GH
    S7 --> FS
    S5 --> MDX
    S6 --> PR

    style S0 fill:#e3f2fd
    style S1 fill:#e3f2fd
    style S4 fill:#e3f2fd
    style S45 fill:#e3f2fd
    style AI fill:#fff9c4
    style FS fill:#ffe0b2
    style GH fill:#c8e6c9
    style YAML fill:#f3e5f5
```

---

## 詳細パイプラインフロー

各ステップの内部処理と外部サービスとのやり取りを sequenceDiagram 形式で示します。

```mermaid
sequenceDiagram
    autonumber
    actor User as ユーザー
    participant MDX as MDX Service
    participant HTML as HTML Extractor
    participant Select as ArticleSelection Service
    participant Extract as extractFromRss
    participant Slug as Slug Resolver
    participant FS as Firestore
    participant GH as GitHub API
    participant Meta as Metadata Generator
    participant TitleSvc as TitleGeneration Service
    participant AI as AI Provider (Claude/Gemini/OpenAI)
    participant YAML as YAML Template

    User->>MDX: generateMdxFromRSS(rssItem)

    Note over MDX,AI: Step 0.5 記事選別
    MDX->>HTML: 記事HTML取得
    HTML-->>MDX: articleHtml
    MDX->>Select: shouldGenerateArticle()
    Select->>YAML: loadModularTemplate('EVENT_TYPE','1-selection')
    YAML-->>Select: template
    Select->>AI: sendMessage(prompt)
    AI-->>Select: JSON response
    Select-->>MDX: should_generate, official_urls

    alt should_generate = false
        MDX-->>User: スキップ (公式URLなし)
    end

    Note over MDX,AI: Step 1 情報抽出
    MDX->>Extract: extractFromRss(rssItem)
    Extract->>AI: RSS から抽出
    AI-->>Extract: workTitle, storeName, eventTypeName
    Extract-->>MDX: extraction

    Note over MDX,Slug: Step 2 Slug 解決
    MDX->>Slug: resolveWorkSlug(workTitle)
    MDX->>Slug: resolveStoreSlug(storeName)
    MDX->>Slug: resolveEventTypeSlug(eventTypeName)
    Slug-->>MDX: workSlug, storeSlug, eventType

    Note over MDX,FS: Step 3 重複チェック & 登録
    MDX->>FS: checkEventDuplication()
    FS-->>MDX: isDuplicate, canonicalKey
    alt isDuplicate
        MDX->>GH: getPrStatusByCanonicalKey()
        GH-->>MDX: hasOpenPr
        alt hasOpenPr
            MDX-->>User: DuplicateSlugError
        else closed
            MDX->>FS: deleteEvent()
        end
    end
    MDX->>FS: registerNewEvent()
    FS-->>MDX: eventRecord

    Note over MDX,AI: Step 4 メタデータ生成
    MDX->>Meta: generateArticleMetadata()
    Meta->>AI: カテゴリ/抜粋生成
    AI-->>Meta: categories, excerpt
    Meta-->>MDX: metadata

    Note over MDX,AI: Step 4.5 タイトル生成
    MDX->>TitleSvc: generateTitle()
    TitleSvc->>YAML: loadModularTemplate('EVENT_TYPE','3-title')
    YAML-->>TitleSvc: template rules
    TitleSvc->>AI: sendMessage(prompt)
    AI-->>TitleSvc: title
    TitleSvc-->>MDX: title, length, is_valid

    Note over MDX,GH: Step 5-7 MDX生成 & PR作成
    MDX->>MDX: generateMdxArticle()
    MDX->>GH: createMdxPr()
    GH-->>MDX: prNumber, prUrl
    MDX->>FS: updateEventStatus('generated')

    MDX-->>User: success, mdxArticle, prResult
```

---

## サービス依存関係図

各サービスがどのレイヤーに属し、どこに依存しているかを示します。

```mermaid
graph LR
    subgraph Services["サービス層"]
        AGMS["ArticleGeneration<br/>MdxService"]
        ASS["ArticleSelection<br/>Service"]
        TGS["TitleGeneration<br/>Service"]
        YTLS["YamlTemplateLoader<br/>Service"]
    end

    subgraph AI["AI プロバイダー層"]
        AIF["AI Factory"]
        ANT["Anthropic<br/>Provider"]
        GEM["Gemini<br/>Provider"]
        OAI["OpenAI<br/>Provider"]
    end

    subgraph Data["データ層"]
        FS[("Firestore")]
        GH["GitHub API"]
        YAML[("YAML<br/>Templates")]
    end

    subgraph Utils["ユーティリティ"]
        EFR["extractFromRss"]
        GAM["generateArticle<br/>Metadata"]
        SR["Slug Resolver"]
        HE["HTML Extractor"]
    end

    AGMS --> ASS
    AGMS --> TGS
    AGMS --> EFR
    AGMS --> GAM
    AGMS --> SR
    AGMS --> HE
    AGMS --> FS
    AGMS --> GH

    ASS --> YTLS
    ASS --> AIF
    TGS --> YTLS
    TGS --> AIF

    YTLS --> YAML

    AIF --> ANT
    AIF --> GEM
    AIF --> OAI

    EFR --> AIF
    GAM --> AIF

    style AGMS fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style AIF fill:#fff9c4,stroke:#f9a825,stroke-width:2px
    style YAML fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
```

---

## YAML テンプレート モジュール構造

プロンプトはイベント種別ごとに `templates/EVENT_TYPE/` 配下にモジュール化されています。

```mermaid
graph TB
    subgraph Templates["templates/EVENT_TYPE/"]
        META["{META}.yaml<br/>メタ情報・順序定義"]

        subgraph Shared["shared/"]
            PH["placeholders.yaml<br/>プレースホルダー定義"]
            CONS["constraints.yaml<br/>文字数制約・バリデーション"]
        end

        subgraph Pipeline["pipeline/"]
            P1["1-selection.yaml<br/>記事選別"]
            P2["2-extraction.yaml<br/>情報抽出"]
            P3["3-title.yaml<br/>タイトル生成"]
            P4["4-content.yaml<br/>本文生成"]
        end

        subgraph Sections["sections/"]
            S1["01-example.yaml"]
            S2["02-example.yaml"]
            S3["03-example.yaml"]
            S4["..."]
        end
    end

    META --> Shared
    META --> Pipeline
    META --> Sections

    style META fill:#ffecb3
    style Shared fill:#e1f5fe
    style Pipeline fill:#f3e5f5
    style Sections fill:#c8e6c9
```

---

## マルチプロバイダー切り替え

`AI_PROVIDER` 環境変数によって、AI Factory が呼び出すプロバイダー実装を切り替えます。

```mermaid
flowchart LR
    ENV["AI_PROVIDER<br/>環境変数"]

    subgraph Factory["AI Factory"]
        direction TB
        CREATE["createAiProvider()"]
    end

    subgraph Providers["プロバイダー"]
        ANT["🟣 Anthropic<br/>Claude"]
        GEM["🔵 Gemini<br/>Google"]
        OAI["🟢 OpenAI<br/>GPT"]
    end

    ENV --> CREATE
    CREATE --> ANT
    CREATE --> GEM
    CREATE --> OAI

    ANT -.->|"default"| CREATE

    style ANT fill:#d1c4e9
    style GEM fill:#bbdefb
    style OAI fill:#c8e6c9
```

---

## 関連ドキュメント

- [現行版 技術スタック](./ARCH-current-stack.md)
- [プロジェクト全体アーキテクチャ（レガシー WordPress 含む歴史的経緯）](./ARCH-project-overview.md)
- [モノレポ運用](../02-mono/MONO-overview.md)
- [CI/CD（AI Writer Cloud Run デプロイ）](../08-cicd/CICD-ai-writer-cloud-run.md)
