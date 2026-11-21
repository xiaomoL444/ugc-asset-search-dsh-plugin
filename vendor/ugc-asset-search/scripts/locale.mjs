import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

let systemLanguage;

export function detectSystemLanguage() {
  if (systemLanguage) return systemLanguage;
  if (process.platform === 'win32') {
    try {
      const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      systemLanguage = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', '(Get-UICulture).Name'], {
        encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // Node's OS locale is available if this host cannot start PowerShell.
    }
  }
  systemLanguage ||= Intl.DateTimeFormat().resolvedOptions().locale;
  return systemLanguage;
}

export function resolveLocale(requested) {
  const value = requested ?? detectSystemLanguage();
  if (typeof value !== 'string') throw new Error('Locale must be a language tag');
  const { language, script, region } = new Intl.Locale(value.trim().replaceAll('_', '-'));
  if (language === 'zh') {
    const traditional = script === 'Hant' || (!script && ['TW', 'HK', 'MO'].includes(region));
    return traditional ? 'zh-TW' : 'zh-CN';
  }
  if (language === 'ja') return 'ja-JP';
  if (language === 'ru') return 'ru-RU';
  return 'en-US';
}
