import { useState } from 'react';
import { CaregiverOnboarding } from './CaregiverOnboarding.jsx';
import { ResidentConsentOnboarding } from './ResidentConsentOnboarding.jsx';

export const onboardingPaths = { caregiver: '/onboarding/caregiver', resident: '/onboarding/resident', main: '/' };

/** Router-neutral wrapper. Supply pathname and navigate from the host router.
 * Resident onComplete is a notification only: keep its completion screen mounted.
 * Change resetKey (or remount the wrapper) to erase all demo state.
 */
export function OnboardingRoute({ pathname, navigate, onComplete, onCancel, resetKey = 0 }) {
  const [generation, setGeneration] = useState(0);
  const flow = pathname.replace(/\/$/, '') === onboardingPaths.caregiver ? 'caregiver' : pathname.replace(/\/$/, '') === onboardingPaths.resident ? 'resident' : null;
  if (!flow) return null;
  const cancel = () => { onCancel?.(flow); navigate?.(onboardingPaths.main); };
  const complete = result => { onComplete?.(result, flow); if (flow === 'caregiver') navigate?.(onboardingPaths.main); };
  const Component = flow === 'caregiver' ? CaregiverOnboarding : ResidentConsentOnboarding;
  return <div className="neulbom-demo-route">
    <Component manageHistory key={`${flow}:${resetKey}:${generation}`} onComplete={complete} onCancel={cancel} />
    <button className="neulbom-demo-reset" type="button" onClick={() => setGeneration(value => value + 1)}>새 시연 시작</button>
  </div>;
}
