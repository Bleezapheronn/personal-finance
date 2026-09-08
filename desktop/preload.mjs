import { contextBridge } from "electron";

const valueFor = (name) => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((candidate) => candidate.startsWith(prefix));
  return argument?.slice(prefix.length);
};

const baseUrl = valueFor("pf-runtime-api-url");
const token = valueFor("pf-runtime-token");

if (!baseUrl || !token) {
  throw new Error("personal_finance_runtime_configuration_missing");
}

contextBridge.exposeInMainWorld("personalFinanceRuntime", {
  localApi: {
    baseUrl,
    token,
    repositoryBackend: "http-sqlite",
  },
});
