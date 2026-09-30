// Vite bundles these local assets; no machine paths or development origins.
const files = import.meta.glob('./assets/**/*', { eager: true, query: '?url', import: 'default' });
export const asset = (name) => files[`./assets/caregiver/${name}`];
export const residentAsset = (name) => files[`./assets/resident/${name}`];
