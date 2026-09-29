import { describeSharingContract } from "../contracts/sharingContract.js";
import { createSqliteStorage } from "./driver.js";

describeSharingContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
