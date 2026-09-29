import { describeAttachmentsContract } from "../contracts/attachmentsContract.js";
import { describeOAuthContract } from "../contracts/oauthContract.js";
import { describePasskeysContract } from "../contracts/passkeysContract.js";
import { describePrefsContract } from "../contracts/prefsContract.js";
import { describePublicLinksContract } from "../contracts/publicLinksContract.js";
import { describeStatsContract } from "../contracts/statsContract.js";
import { describeSyncContract } from "../contracts/syncContract.js";
import { describeTeamsContract } from "../contracts/teamsContract.js";
import { createSqliteStorage } from "./driver.js";

describeAttachmentsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeStatsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePrefsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeSyncContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePublicLinksContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeTeamsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeOAuthContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePasskeysContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
