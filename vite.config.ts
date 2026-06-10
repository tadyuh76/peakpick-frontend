import { defineConfig, loadEnv } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host: string) => host.trim())
    .filter(Boolean);

  return {
    plugins: [solid()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      allowedHosts
    }
  };
});
