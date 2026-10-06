import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const GUARD = join(__dirname, '../../../../../scripts/check-i18n.mjs');

interface Finding {
  line: number;
  kind: string;
  text: string;
}

function scan(platform: 'web' | 'mobile' | 'api', fileName: string, source: string): Finding[] {
  const out = execFileSync('node', [GUARD, '--stdin', platform, fileName], { input: source, encoding: 'utf8' });
  return JSON.parse(out) as Finding[];
}

describe('i18n regression guard (scripts/check-i18n.mjs)', () => {
  it('passes on the repository: no Turkish-character copy outside messages/ (web, mobile, API), no native dialogs, no bare Alert.alert', () => {
    const res = spawnSync('node', [GUARD], { encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('flags a Turkish-character string literal and JSX text', () => {
    const findings = scan('web', 'a.tsx', "const a = 'Değişti';\nconst b = 'Kaydet';\nexport const C = () => <p>Üyeler</p>;\n");
    expect(findings.map((f) => f.kind)).toEqual(['turkish', 'turkish']);
    expect(findings[1]?.text).toBe('Üyeler');
  });

  it('ignores Turkish text in comments', () => {
    expect(scan('web', 'a.ts', '// Üyeler listesi\n/* Kaydedilmedi */\nexport const a = 1;\n')).toEqual([]);
  });

  it('flags window.confirm, window.alert, window.prompt and undeclared bare calls in web', () => {
    const kinds = scan('web', 'a.tsx', "window.confirm('x');\nwindow.alert('x');\nwindow.prompt('x');\nconfirm('x');\nalert('x');\n").map((f) => f.kind);
    expect(kinds).toEqual(['native-dialog', 'native-dialog', 'native-dialog', 'native-dialog', 'native-dialog']);
  });

  it('accepts confirm/prompt that come from useConfirm()', () => {
    const source = "function C() {\n  const { confirm, prompt } = useConfirm();\n  void confirm({ message: 'x' });\n  void prompt({ message: 'x', inputLabel: 'y' });\n}\n";
    expect(scan('web', 'a.tsx', source)).toEqual([]);
  });

  it('flags Alert.alert without a buttons array in mobile and accepts one with buttons', () => {
    expect(scan('mobile', 'a.tsx', "Alert.alert('t', 'm');\n").map((f) => f.kind)).toEqual(['alert-no-buttons']);
    expect(scan('mobile', 'a.tsx', "Alert.alert('t', 'm', [{ text: 'ok' }]);\n")).toEqual([]);
  });

  it('flags a Turkish-character or ASCII-transliterated Turkish literal in the API', () => {
    const source = "const a = { message: 'Rezervasyon iptal edildi' };\nconst b = `${x} kodunuz`;\nconst c = 'Giris kodunuz';\nconst d = 'Booking cancelled';\n";
    expect(scan('api', 'a.ts', source).map((f) => f.kind)).toEqual(['turkish', 'turkish']);
    expect(scan('api', 'a.ts', "const a = 'Değişti';\n").map((f) => f.kind)).toEqual(['turkish']);
  });

  it('lets the API log operator text, comments and English diagnostics through', () => {
    const source = "// Üyeler\nthis.logger.warn(`İYS revocation failed: ${e}`);\nLogger.error('İleti Merkezi failed');\nconst a = 'Endpoint is inactive';\n";
    expect(scan('api', 'a.ts', source)).toEqual([]);
  });
});
