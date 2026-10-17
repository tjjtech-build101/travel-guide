// Metro para el monorepo pnpm.
// Desde SDK 52, expo/metro-config detecta el monorepo solo (agrega la raíz a watchFolders y
// resuelve node_modules de la raíz), así que NO seteamos watchFolders/nodeModulesPaths a mano
// (la guía de monorepos de Expo pide no hacerlo). @build101/shared se consume como fuente TS
// ("main": "src/index.ts") y Metro lo transpila como cualquier archivo del proyecto.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
