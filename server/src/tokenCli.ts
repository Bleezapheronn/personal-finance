import { readOrCreateToken, rotateToken } from "./tokenStore.js";

const command = process.argv[2];

const main = async (): Promise<void> => {
  if (command === "show") {
    console.log(await readOrCreateToken());
    return;
  }

  if (command === "rotate") {
    console.log(await rotateToken());
    return;
  }

  console.error("Usage: tsx src/tokenCli.ts <show|rotate>");
  process.exit(1);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
