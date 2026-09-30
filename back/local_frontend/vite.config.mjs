import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { forwardContentSaveError } from './contentUploadErrors.mjs';
import { connectMealAlarmPage } from './mealAlarmTransform.mjs';

const bridgeDir = path.dirname(fileURLToPath(import.meta.url));
const teamFrontend = realpathSync(path.resolve(bridgeDir, '../../frontend/frontend'));
const appFile = path.join(teamFrontend, 'src/App.jsx');
const localPage = path.join(bridgeDir, 'LocalNeulbomPage.jsx');
const localDailyReport = path.join(bridgeDir, 'LocalDailyReport.jsx');
const localVoicePage = path.join(bridgeDir, 'LocalVoiceTrainingPage.jsx');
const localContentPage = path.join(bridgeDir, 'LocalPreferredContentPage.jsx');
const localMealPage = path.join(bridgeDir, 'LocalMealMedicationCarePage.jsx');
const localCalmPage = path.join(bridgeDir, 'LocalCalmCarePage.jsx');
const localNeulbomData = path.join(bridgeDir, 'LocalNeulbomData.mjs');
const teamNeulbomPage = path.join(teamFrontend, 'src/NeulbomPage.jsx');
const expandedApplianceDefault = "  const [expandedDevices, setExpandedDevices] = useState(() => new Set(['purifier', 'refrigerator', 'tv']));";
const collapsedApplianceDefault = '  const [expandedDevices, setExpandedDevices] = useState(() => new Set());';
const careCardSignature = 'function CareTodayCard({ overview, recentCare, onRefresh, onEmergency }) {';
const connectedCareCardSignature = 'function CareTodayCard({ overview, recentCare, onRefresh, onEmergency, ariaLabel }) {';
const careAriaLabel = 'aria-label="오늘의 돌봄 상태"';
const connectedCareAriaLabel = 'aria-label={ariaLabel}';
const neulbomPropsStart = `export default function NeulbomPage({
  onBack,`;
const connectedNeulbomPropsStart = `export default function NeulbomPage({
  onBack,
  applianceUsageResetKey,
  careStatusAriaLabel,`;
const applianceSectionCall = '<ApplianceSection devices={applianceUsage} />';
const connectedApplianceSectionCall = '<ApplianceSection key={applianceUsageResetKey} devices={applianceUsage} />';
const careCardCall = `<CareTodayCard
                overview={displayedCareOverview}
                recentCare={recentCare}
                onRefresh={onRefreshCare}
                onEmergency={latestEmergency ? () => setShowEmergencySummary(true) : undefined}
              />`;
const connectedCareCardCall = `<CareTodayCard
                overview={displayedCareOverview}
                recentCare={recentCare}
                onRefresh={onRefreshCare}
                onEmergency={latestEmergency ? () => setShowEmergencySummary(true) : undefined}
                ariaLabel={careStatusAriaLabel}
              />`;

// Fail visibly after an upstream change instead of silently falling back to mock data.
if (!readFileSync(appFile, 'utf8').includes("import NeulbomPage from './NeulbomPage.jsx'")) {
  throw new Error('팀원 App.jsx의 NeulbomPage import가 변경됐습니다. 로컬 브리지 연결을 확인하세요.');
}
if (!readFileSync(path.join(teamFrontend, 'src/NeulbomPage.jsx'), 'utf8').includes("import VoiceTrainingPage from './VoiceTrainingPage.jsx'")) {
  throw new Error('팀원 음성 화면 import가 변경됐습니다. 로컬 음성 연결을 확인하세요.');
}
if (!readFileSync(path.join(teamFrontend, 'src/NeulbomPage.jsx'), 'utf8').includes("import PreferredContentPage from './PreferredContentPage.jsx'")) {
  throw new Error('팀원 선호 콘텐츠 화면 import가 변경됐습니다. 로컬 콘텐츠 연결을 확인하세요.');
}
if (!readFileSync(path.join(teamFrontend, 'src/NeulbomPage.jsx'), 'utf8').includes("import MealMedicationCarePage from './MealMedicationCarePage.jsx'")) {
  throw new Error('팀원 식사·복약 화면 import가 변경됐습니다. 로컬 알림 연결을 확인하세요.');
}
if (!readFileSync(path.join(teamFrontend, 'src/NeulbomPage.jsx'), 'utf8').includes("import DailyReport from './DailyReport.jsx'")) {
  throw new Error('팀원 데일리 리포트 import가 변경됐습니다. 로컬 리포트 연결을 확인하세요.');
}
if (!readFileSync(path.join(teamFrontend, 'src/NeulbomPage.jsx'), 'utf8').includes("import CalmCarePage from './CalmCarePage.jsx'")) {
  throw new Error('팀원 안정 돌봄 화면 import가 변경됐습니다. 로컬 분노 감지 연결을 확인하세요.');
}

export default defineConfig({
  root: bridgeDir,
  publicDir: path.join(teamFrontend, 'public'),
  cacheDir: path.join(bridgeDir, 'node_modules/.vite'),
  plugins: [
    {
      name: 'local-content-error-bridge',
      enforce: 'pre',
      transform(source, id) {
        if (id.split('?')[0] === teamNeulbomPage) {
          const requiredAnchors = [expandedApplianceDefault, careCardSignature, careAriaLabel,
            neulbomPropsStart, applianceSectionCall, careCardCall];
          if (requiredAnchors.some((anchor) => !source.includes(anchor))) {
            throw new Error('팀원 늘봄 화면 구조가 변경됐습니다. 로컬 돌봄 브리지 연결을 확인하세요.');
          }
          return source
            .replace(expandedApplianceDefault, collapsedApplianceDefault)
            .replace(careCardSignature, connectedCareCardSignature)
            .replace(careAriaLabel, connectedCareAriaLabel)
            .replace(neulbomPropsStart, connectedNeulbomPropsStart)
            .replace(applianceSectionCall, connectedApplianceSectionCall)
            .replace(careCardCall, connectedCareCardCall);
        }
        if (id.split('?')[0] === path.join(teamFrontend, 'src/PreferredContentPage.jsx')) {
          return forwardContentSaveError(source);
        }
        if (id.split('?')[0] === path.join(teamFrontend, 'src/MealMedicationCarePage.jsx')) {
          return connectMealAlarmPage(source);
        }
      },
    },
    react(),
  ],
  resolve: {
    alias: [
      { find: './NeulbomPage.jsx', replacement: localPage },
      { find: './DailyReport.jsx', replacement: localDailyReport },
      { find: './VoiceTrainingPage.jsx', replacement: localVoicePage },
      { find: './PreferredContentPage.jsx', replacement: localContentPage },
      { find: './MealMedicationCarePage.jsx', replacement: localMealPage },
      { find: './CalmCarePage.jsx', replacement: localCalmPage },
      { find: './data/neulbomData.js', replacement: localNeulbomData },
      { find: 'react-dom', replacement: path.join(bridgeDir, 'node_modules/react-dom') },
      { find: 'react', replacement: path.join(bridgeDir, 'node_modules/react') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    fs: { allow: [bridgeDir, teamFrontend] },
    proxy: {
      '/api/safety-care': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/api/anger': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/api/playback': { target: 'http://127.0.0.1:3001', changeOrigin: false },
      '/ws/playback': { target: 'ws://127.0.0.1:3001', ws: true, changeOrigin: false },
      '/api/voice': { target: 'http://127.0.0.1:8081', changeOrigin: false },
      // Preserve the browser Host: Spring rejects LAN Origin + rewritten localhost Host on POST.
      '/api/content': { target: 'http://127.0.0.1:8081', changeOrigin: false },
      '/api/alarms': { target: 'http://127.0.0.1:8081', changeOrigin: false },
      '/api/tts': { target: 'http://127.0.0.1:8081', changeOrigin: false },
      '/api/config/elevenlabs': { target: 'http://127.0.0.1:8081', changeOrigin: true },
      '/api/v1/reports': { target: 'http://127.0.0.1:8002', changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
});
