// auto-loader.js
const Module = require("module");
const { execSync } = require("child_process");

const originalRequire = Module.prototype.require;

Module.prototype.require = function (moduleName) {
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND" && err.message.includes(`'${moduleName}'`)) {
      console.log(`Módulo "${moduleName}" não encontrado. Instalando...`);
      execSync(`npm install ${moduleName}`, { stdio: "inherit" });
      return originalRequire.apply(this, arguments);
    }
    throw err;
  }
};
