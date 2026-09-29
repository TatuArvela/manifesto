import { describeAttachmentsContract } from "../attachmentsContract.js";
import { describeOAuthContract } from "../oauthContract.js";
import { describePasskeysContract } from "../passkeysContract.js";
import { describePrefsContract } from "../prefsContract.js";
import { describePublicLinksContract } from "../publicLinksContract.js";
import { describeStatsContract } from "../statsContract.js";
import { describeSyncContract } from "../syncContract.js";
import { describeTeamsContract } from "../teamsContract.js";
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
