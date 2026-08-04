import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    sourcemap: false,
    // react / react-dom peerDependencies hain — bundle mein include nahi honge
    external: ["react", "react-dom", "react/jsx-runtime"],
    minify: false,
  },
  {
    entry: { poseWorker: "src/workers/poseWorker.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: false,
    platform: "browser",
    splitting: false,
    // TensorFlow packages must stay bundled into the worker file; otherwise a
    // published module worker would contain browser-unresolvable bare imports.
    noExternal: [/^@tensorflow\//, "@tensorflow-models/pose-detection"],
    minify: false,
  },
]);
