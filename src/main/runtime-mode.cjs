"use strict";

const ENV = Object.freeze({
  development: "FLUX_DEVELOPMENT",
  integrated: "FLUX_INTEGRATED",
  userData: "FLUX_DEV_USER_DATA"
});

function resolveRuntimeMode(env = process.env) {
  const isDevelopment = env[ENV.development] === "1";
  const isIntegrated = isDevelopment && env[ENV.integrated] === "1";
  return Object.freeze({
    isDevelopment,
    isIntegrated,
    localOnly: true,
    userDataPath: isDevelopment ? env[ENV.userData] || null : null
  });
}

module.exports = { ENV, resolveRuntimeMode };
