/**
 * @fileoverview Unit Tests for MediaTypeMapperService (v1.4.0)
 *
 * @description
 * メディアタイプ別セパレーター設定サービスのユニットテスト。
 * カバレッジ目標: 90%以上
 *
 * @see /apps/ai-writer/lib/services/media-type-mapper.service.ts
 * @since v1.4.0
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  MediaTypeMapperService,
  getMediaTypeMapperService,
  resetMediaTypeMapperService,
} from '../../lib/services/media-type-mapper.service';

describe('MediaTypeMapperService', () => {
  let testConfigPath: string;
  let validYaml: string;

  beforeEach(() => {
    // テスト用のYAMLファイルパスを作成
    testConfigPath = path.join(__dirname, '../fixtures/media-type-mapping-test.yaml');

    // テスト用の有効なYAML設定
    validYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: 'アニメ'
    character_separator: '・'
    description: 'アニメーション作品'
  idol:
    label: 'アイドル'
    character_separator: ' / '
    description: 'アイドルグループ'
    notes: '業界慣例として " / " を使用'
  utaite:
    label: '歌い手'
    character_separator: ' / '
    description: '歌い手・ボーカリスト'
  game:
    label: 'ゲーム'
    character_separator: '・'
    description: 'ゲーム作品'
separator_rules:
  default: '・'
  idol_utaite: ' / '
  reason: 'アイドル・歌い手業界では、メンバー名を " / " で区切る慣例があります。'
author_name_rules:
  separator: ' / '
  applies_to_media_types: false
  reason: '原作者名は作品のクリエイターであり、キャラクターやメンバーとは異なります。'
`;

    // Singleton インスタンスをリセット
    resetMediaTypeMapperService();
  });

  afterEach(() => {
    // テスト用ファイルのクリーンアップ
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }

    // テストディレクトリのクリーンアップ
    const fixturesDir = path.join(__dirname, '../fixtures');
    if (fs.existsSync(fixturesDir) && fs.readdirSync(fixturesDir).length === 0) {
      fs.rmdirSync(fixturesDir);
    }

    // Singleton インスタンスをリセット
    resetMediaTypeMapperService();
  });

  describe('Constructor', () => {
    describe('正常系', () => {
      it('有効なYAMLファイルから設定を読み込めること', () => {
        // Arrange: テスト用YAMLファイルを作成
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, validYaml, 'utf-8');

        // Act: サービスを初期化
        const service = new MediaTypeMapperService(testConfigPath);

        // Assert: 設定が正しく読み込まれていること
        expect(service.getSeparator('anime')).toBe('・');
        expect(service.getSeparator('idol')).toBe(' / ');
        expect(service.getLabel('anime')).toBe('アニメ');
        expect(service.getLabel('idol')).toBe('アイドル');
      });

      it('デフォルトパス（未指定時）で初期化できること', () => {
        // デフォルトパスのYAMLファイルが存在することを前提とする
        // 実際の config/media-type-mapping.yaml を使用
        expect(() => {
          new MediaTypeMapperService();
        }).not.toThrow();
      });
    });

    describe('異常系', () => {
      it('YAMLファイルが存在しない場合はエラーを投げること', () => {
        const nonExistentPath = '/path/to/nonexistent/config.yaml';

        expect(() => {
          new MediaTypeMapperService(nonExistentPath);
        }).toThrow('Media type mapping config not found');
      });

      it('必須フィールド（media_type_mappings）がない場合はエラーを投げること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
# media_type_mappings がない
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('media_type_mappings');
      });

      it('必須フィールド（label）がないメディアタイプがある場合はエラーを投げること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    # label がない
    character_separator: '・'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('label');
      });

      it('必須フィールド（character_separator）がないメディアタイプがある場合はエラーを投げること', () => {
        const invalidYaml = `
version: '1.0.0'
media_type_mappings:
  anime:
    label: 'アニメ'
    # character_separator がない
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow("character_separator");
      });

      it('YAMLシンタックスエラーを適切に検出すること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: "アニメ
    character_separator: '・'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('YAML syntax error');
      });

      it('空文字列のセパレーターを検出すること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: 'アニメ'
    character_separator: ''
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('Character separator must not be empty');
      });

      it('空文字列のラベルを検出すること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: ''
    character_separator: '・'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('Label must not be empty');
      });

      it('不正なバージョン形式を検出すること', () => {
        const invalidYaml = `
version: 'invalid-version'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: 'アニメ'
    character_separator: '・'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('Version must be in semver format');
      });

      it('不正な日付形式を検出すること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026/01/12'
media_type_mappings:
  anime:
    label: 'アニメ'
    character_separator: '・'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('Date must be in YYYY-MM-DD format');
      });

      it('長すぎるラベル（20文字超）を検出すること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: 'これは20文字を超える非常に長いラベル名です'
    character_separator: '・'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('Label must be 20 characters or less');
      });

      it('長すぎるセパレーター（10文字超）を検出すること', () => {
        const invalidYaml = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  anime:
    label: 'アニメ'
    character_separator: '12345678901'
`;
        const fixturesDir = path.dirname(testConfigPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(testConfigPath, invalidYaml, 'utf-8');

        expect(() => {
          new MediaTypeMapperService(testConfigPath);
        }).toThrow('Character separator must be 10 characters or less');
      });
    });
  });

  describe('getSeparator', () => {
    let service: MediaTypeMapperService;

    beforeEach(() => {
      const fixturesDir = path.dirname(testConfigPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testConfigPath, validYaml, 'utf-8');
      service = new MediaTypeMapperService(testConfigPath);
    });

    describe('正常系', () => {
      it('anime の場合は "・" を返すこと', () => {
        expect(service.getSeparator('anime')).toBe('・');
      });

      it('idol の場合は " / " を返すこと', () => {
        expect(service.getSeparator('idol')).toBe(' / ');
      });

      it('utaite の場合は " / " を返すこと', () => {
        expect(service.getSeparator('utaite')).toBe(' / ');
      });

      it('game の場合は "・" を返すこと', () => {
        expect(service.getSeparator('game')).toBe('・');
      });
    });

    describe('未定義のメディアタイプ', () => {
      it('未定義のメディアタイプの場合はデフォルト "・" を返すこと', () => {
        expect(service.getSeparator('unknown')).toBe('・');
      });

      it('空文字列の場合もデフォルト "・" を返すこと', () => {
        expect(service.getSeparator('')).toBe('・');
      });
    });
  });

  describe('getLabel', () => {
    let service: MediaTypeMapperService;

    beforeEach(() => {
      const fixturesDir = path.dirname(testConfigPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testConfigPath, validYaml, 'utf-8');
      service = new MediaTypeMapperService(testConfigPath);
    });

    describe('正常系', () => {
      it('anime の場合は "アニメ" を返すこと', () => {
        expect(service.getLabel('anime')).toBe('アニメ');
      });

      it('idol の場合は "アイドル" を返すこと', () => {
        expect(service.getLabel('idol')).toBe('アイドル');
      });

      it('utaite の場合は "歌い手" を返すこと', () => {
        expect(service.getLabel('utaite')).toBe('歌い手');
      });

      it('game の場合は "ゲーム" を返すこと', () => {
        expect(service.getLabel('game')).toBe('ゲーム');
      });
    });

    describe('未定義のメディアタイプ', () => {
      it('未定義のメディアタイプの場合はそのまま返すこと', () => {
        expect(service.getLabel('unknown')).toBe('unknown');
      });

      it('空文字列の場合もそのまま返すこと', () => {
        expect(service.getLabel('')).toBe('');
      });
    });
  });

  describe('isIdolOrUtaite', () => {
    let service: MediaTypeMapperService;

    beforeEach(() => {
      const fixturesDir = path.dirname(testConfigPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testConfigPath, validYaml, 'utf-8');
      service = new MediaTypeMapperService(testConfigPath);
    });

    describe('idol/utaite の場合', () => {
      it('idol の場合は true を返すこと', () => {
        expect(service.isIdolOrUtaite('idol')).toBe(true);
      });

      it('utaite の場合は true を返すこと', () => {
        expect(service.isIdolOrUtaite('utaite')).toBe(true);
      });
    });

    describe('その他のメディアタイプの場合', () => {
      it('anime の場合は false を返すこと', () => {
        expect(service.isIdolOrUtaite('anime')).toBe(false);
      });

      it('game の場合は false を返すこと', () => {
        expect(service.isIdolOrUtaite('game')).toBe(false);
      });

      it('unknown の場合は false を返すこと', () => {
        expect(service.isIdolOrUtaite('unknown')).toBe(false);
      });

      it('空文字列の場合は false を返すこと', () => {
        expect(service.isIdolOrUtaite('')).toBe(false);
      });
    });
  });

  describe('getAllMappings', () => {
    let service: MediaTypeMapperService;

    beforeEach(() => {
      const fixturesDir = path.dirname(testConfigPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testConfigPath, validYaml, 'utf-8');
      service = new MediaTypeMapperService(testConfigPath);
    });

    it('すべてのメディアタイプマッピングを取得できること', () => {
      const mappings = service.getAllMappings();

      expect(mappings).toHaveProperty('anime');
      expect(mappings).toHaveProperty('idol');
      expect(mappings).toHaveProperty('utaite');
      expect(mappings).toHaveProperty('game');
    });

    it('各マッピングが必須フィールドを持っていること', () => {
      const mappings = service.getAllMappings();

      expect(mappings.anime).toHaveProperty('label');
      expect(mappings.anime).toHaveProperty('character_separator');
      expect(mappings.idol).toHaveProperty('label');
      expect(mappings.idol).toHaveProperty('character_separator');
    });

    it('正しい値が格納されていること', () => {
      const mappings = service.getAllMappings();

      expect(mappings.anime.label).toBe('アニメ');
      expect(mappings.anime.character_separator).toBe('・');
      expect(mappings.idol.label).toBe('アイドル');
      expect(mappings.idol.character_separator).toBe(' / ');
    });
  });

  describe('getVersion', () => {
    let service: MediaTypeMapperService;

    beforeEach(() => {
      const fixturesDir = path.dirname(testConfigPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testConfigPath, validYaml, 'utf-8');
      service = new MediaTypeMapperService(testConfigPath);
    });

    it('設定ファイルのバージョンを取得できること', () => {
      expect(service.getVersion()).toBe('1.0.0');
    });
  });

  describe('Singleton Pattern', () => {
    it('getMediaTypeMapperService() で同一インスタンスを取得できること', () => {
      const instance1 = getMediaTypeMapperService();
      const instance2 = getMediaTypeMapperService();

      expect(instance1).toBe(instance2);
    });

    it('resetMediaTypeMapperService() でインスタンスをリセットできること', () => {
      const instance1 = getMediaTypeMapperService();
      resetMediaTypeMapperService();
      const instance2 = getMediaTypeMapperService();

      expect(instance1).not.toBe(instance2);
    });

    it('Singleton インスタンスは実際の config/media-type-mapping.yaml を使用すること', () => {
      const service = getMediaTypeMapperService();

      // 実際の設定ファイルに定義されているメディアタイプをテスト
      expect(service.getSeparator('anime')).toBe('・');
      expect(service.getSeparator('idol')).toBe(' / ');
      expect(service.getLabel('anime')).toBe('アニメ');
    });
  });

  describe('エッジケース', () => {
    let service: MediaTypeMapperService;

    beforeEach(() => {
      const fixturesDir = path.dirname(testConfigPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testConfigPath, validYaml, 'utf-8');
      service = new MediaTypeMapperService(testConfigPath);
    });

    describe('大文字小文字の区別', () => {
      it('メディアタイプは大文字小文字を区別すること', () => {
        expect(service.getSeparator('Anime')).toBe('・'); // デフォルト（未定義扱い）
        expect(service.getSeparator('IDOL')).toBe('・'); // デフォルト（未定義扱い）
      });
    });

    describe('特殊文字を含むメディアタイプ', () => {
      it('ハイフンを含むメディアタイプでも動作すること', () => {
        const yamlWithHyphen = `
version: '1.0.0'
last_updated: '2026-01-12'
media_type_mappings:
  light-novel:
    label: 'ライトノベル'
    character_separator: '・'
`;
        const hyphenPath = path.join(__dirname, '../fixtures/hyphen-test.yaml');
        const fixturesDir = path.dirname(hyphenPath);
        if (!fs.existsSync(fixturesDir)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
        }
        fs.writeFileSync(hyphenPath, yamlWithHyphen, 'utf-8');

        const hyphenService = new MediaTypeMapperService(hyphenPath);
        expect(hyphenService.getSeparator('light-novel')).toBe('・');
        expect(hyphenService.getLabel('light-novel')).toBe('ライトノベル');

        // クリーンアップ
        fs.unlinkSync(hyphenPath);
      });
    });
  });

  describe('統合テスト: 実際のYAMLファイルとの整合性', () => {
    it('実際の config/media-type-mapping.yaml が有効であること', () => {
      const actualConfigPath = path.join(
        process.cwd(),
        'config',
        'media-type-mapping.yaml'
      );

      expect(fs.existsSync(actualConfigPath)).toBe(true);

      const service = new MediaTypeMapperService(actualConfigPath);

      // 実際の設定ファイルに定義されている主要なメディアタイプをテスト
      expect(service.getSeparator('anime')).toBe('・');
      expect(service.getSeparator('idol')).toBe(' / ');
      expect(service.getSeparator('utaite')).toBe(' / ');
      expect(service.getLabel('anime')).toBe('アニメ');
      expect(service.getLabel('idol')).toBe('アイドル');
      expect(service.isIdolOrUtaite('idol')).toBe(true);
      expect(service.isIdolOrUtaite('anime')).toBe(false);
    });
  });
});
