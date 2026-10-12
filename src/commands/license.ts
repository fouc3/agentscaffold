import { loadPacks } from '../pack/pack.js';
import { buildLicenseReport, formatLicenseHuman, formatLicenseJson } from '../license/notice.js';
import { toolVersion } from '../util/version.js';

export interface LicenseFlags {
  json?: boolean;
}

export function runLicense(flags: LicenseFlags): number {
  const report = buildLicenseReport(loadPacks(), toolVersion);
  process.stdout.write(flags.json === true ? formatLicenseJson(report) : formatLicenseHuman(report));
  return 0;
}
