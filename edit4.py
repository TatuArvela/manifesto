S = "packages/server/src/"
C = "packages/client/src/"


def sub(p, old, new):
    s = open(p).read()
    assert s.count(old) == 1, (p, old)
    open(p, "w").write(s.replace(old, new))


# Repository: deny.
sub(S + "storage/repos/signIn.ts", '''  /**
   * Uses an approved request, atomically,''', '''  /**
   * Ends a pending request that its person refused. False for a request that
   * is gone, or that was approved before.
   */
  deny(idHash: string, now: string): Promise<boolean>;
  /**
   * Uses an approved request, atomically,''')
sub(S + "storage/sqlite/deviceSignInsRepo.ts", '''  const claimStmt = db.prepare(''', '''  const denyStmt = db.prepare(
    `UPDATE device_sign_ins SET used_at = @now
     WHERE id_hash = @idHash AND approved_at IS NULL AND used_at IS NULL
       AND expires_at > @now`,
  );
  const claimStmt = db.prepare(''')
sub(S + "storage/sqlite/deviceSignInsRepo.ts", '''    async claim(waitHash, now) {''', '''    async deny(idHash, now) {
      return denyStmt.run({ idHash, now }).changes === 1;
    },
    async claim(waitHash, now) {''')
sub(S + "storage/postgres/deviceSignInsRepo.ts", '''    async claim(waitHash, now) {''', '''    async deny(idHash, now) {
      const result = await pool.query(
        `UPDATE device_sign_ins SET used_at = $2
         WHERE id_hash = $1 AND approved_at IS NULL AND used_at IS NULL
           AND expires_at > $2`,
        [idHash, now],
      );
      return result.rowCount === 1;
    },
    async claim(waitHash, now) {''')

# The route.
sub(S + "auth/deviceSignIn.ts", '''  router.post(
    "/device-sign-in/wait",''', '''  // "Not me" on the approving device. The request ends, and the log of the
  // account keeps the refusal. Thus, a person who was sent a code by somebody
  // else finds it again on the Activity page.
  router.post(
    "/device-sign-in/deny",
    zValidator("json", deviceSignInInspectSchema, validatorHook),
    async (c) => {
      const auth = c.get("auth");
      const { id } = c.req.valid("json");
      if (!(await storage.deviceSignIns.deny(hashToken(id), nowIso()))) {
        throw gone();
      }
      audit(storage, c, {
        action: "auth.device_sign_in_denied",
        actorId: auth.userId,
      });
      return c.body(null, 204);
    },
  );

  router.post(
    "/device-sign-in/wait",''')
sub(S + "auth/deviceSignIn.ts", ''' * - The new device asks (`wait`) until the approval is there.''', ''' * - The new device asks (`wait`) until the approval is there. "Not me" on the
 *   approving device ends the request (`deny`), and the log records it.''')

s = open(S + "openapi/auth.ts").read()
marker = '''  {
    method: "post",
    path: "/api/v1/auth/device-sign-in/wait",'''
assert s.count(marker) == 1
s = s.replace(marker, '''  {
    method: "post",
    path: "/api/v1/auth/device-sign-in/deny",
    tag: "Auth",
    summary: "Refuse a request to sign in a new device; the log records it",
    auth: "session",
    limits: [],
    feature: "deviceSignIn",
    body: deviceSignInInspectSchema,
    responses: {
      ...noContent,
      "410": { description: "Expired or used", schema: "Error" },
    },
  },
''' + marker)
open(S + "openapi/auth.ts", "w").write(s)

sub("packages/shared/src/api/audit.ts", '  "auth.device_sign_in_approved",\n', '  "auth.device_sign_in_approved",\n  "auth.device_sign_in_denied",\n')
sub(C + "i18n/messages/en.ts", '''  "audit.action.auth.device_sign_in_approved": "Approved a sign-in on a new device",\n''', '''  "audit.action.auth.device_sign_in_approved": "Approved a sign-in on a new device",\n  "audit.action.auth.device_sign_in_denied": "Refused a sign-in on a new device",\n''')
sub(C + "i18n/messages/fi.ts", '''  "audit.action.auth.device_sign_in_approved":''', '''  "audit.action.auth.device_sign_in_denied":
    "Hylkäsi kirjautumisen uudella laitteella",
  "audit.action.auth.device_sign_in_approved":''')

# Client.
sub(C + "state/account/deviceSignIn.ts", '''export type ApproveResult''', '''/**
 * "Not me": ends the request, and the log of the account records it. A request
 * that is already gone needs nothing, so the answer is not shown.
 */
export async function denyDeviceSignIn(id: string): Promise<void> {
  await apiFetch("POST", "/auth/device-sign-in/deny", { id });
}

export type ApproveResult''')
sub(C + "components/login/DeviceSignInApproval.tsx", '''  approveDeviceSignIn,
''', '''  approveDeviceSignIn,
  denyDeviceSignIn,
''')
sub(C + "components/login/DeviceSignInApproval.tsx", '''  const submit = async''', '''  const deny = () => {
    void denyDeviceSignIn(request.id);
    dismiss();
  };

  const submit = async''')
sub(C + "components/login/DeviceSignInApproval.tsx", '''              onClick={dismiss}
            >
              {t(ready ? "deviceSignIn.deny" : "confirm.cancel")}''', '''              onClick={ready ? deny : dismiss}
            >
              {t(ready ? "deviceSignIn.deny" : "confirm.cancel")}''')

# Docs.
sub("docs/specification/features/accounts.md", '''- The audit log records the approval as "Approved a sign-in on a new device", and the sign-in with
  `method: "device"`. The sign-in ends no other session.''', '''- **Not me** ends the request. The new device then says that its code expired.
- The audit log records the approval as "Approved a sign-in on a new device", a refusal as
  "Refused a sign-in on a new device", and the sign-in with `method: "device"`. Thus, a person who
  refused a code that somebody sent them finds it again on the Activity page. The sign-in ends no
  other session.''')
