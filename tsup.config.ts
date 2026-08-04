import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // react / react-dom peerDependencies hain — bundle mein include nahi honge
  external: ["react", "react-dom", "react/jsx-runtime"],
  minify: false,
});
