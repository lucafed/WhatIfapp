// minimal stub ffmpeg-core.js
Module = typeof Module !== "undefined" ? Module : {};
Module.FS = {
  files: {},
  writeFile: function (name, data) {
    this.files[name] = data;
  },
  readFile: function (name) {
    return this.files[name] || new Uint8Array();
  },
};
Module.callMain = function () {
  // mock
  return 0;
};
Module.onRuntimeInitialized();
