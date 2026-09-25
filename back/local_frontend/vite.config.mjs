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
const localNeulbomData = path.join(bridgeDir, 'LocalNeulbomData.mjs');
const teamNeulbomPage = path.join(teamFrontend, 'src/NeulbomPage.jsx');
const expandedApplianceDefault = "  const [expandedDevices, setExpandedDevices] = useState(() => new Set(['purifier', 'refrigerator', 'tv']));";
const collapsedApplianceDefault = '  const [expandedDevices, setExpandedDevices] = useState(() => new Set());';

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
          if (!source.includes(expandedApplianceDefault)) {
            throw new Error('팀원 제품 상세 내역의 초기 펼침 구조가 변경됐습니다. 로컬 기본 닫힘 설정을 확인하세요.');
          }
          return source.replace(expandedApplianceDefault, collapsedApplianceDefault);
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
