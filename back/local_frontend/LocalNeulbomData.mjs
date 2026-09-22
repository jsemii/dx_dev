import {
  applianceUsageMock,
  careFeatures,
  careOverviewMock,
  customCareSettings as teamCustomCareSettings,
  recentCareMock,
} from '../../frontend/frontend/src/data/neulbomData.js';

export { applianceUsageMock, careFeatures, careOverviewMock, recentCareMock };

// The teammate's fixed "2 registered voices" is not backed by the voice DB.
export const customCareSettings = teamCustomCareSettings.map((setting) => {
  if (setting.id === 'voice') return { ...setting, description: '목소리 등록 관리' };
  if (setting.id === 'content') return { ...setting, description: '콘텐츠 등록 관리' };
  return setting;
});
