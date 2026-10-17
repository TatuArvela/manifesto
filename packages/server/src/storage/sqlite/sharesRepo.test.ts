import { describeSharingContract } from "#/storage/contracts/sharingContract.ts";
import { createSqliteStorage } from "./driver.ts";

describeSharingContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
