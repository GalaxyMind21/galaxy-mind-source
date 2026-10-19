// check-roster.mjs: the post-deploy roster smoke check counts ids the same way fleet-ids.ts does.
import assert from "node:assert/strict";
import { parseRigRoster, parseIdList } from "../src/lib/fleet-ids";
import { countIds, apiRigCount } from "./check-roster.mjs";

for (const raw of ["", "12345", "123456", "123456,123456", "123456=Avalon Q,654321", " 111111 , abc,222222=x=y", undefined]) {
  assert.equal(countIds(raw), parseRigRoster(raw).ids.length, `rig count agrees with fleet-ids for ${JSON.stringify(raw)}`);
}
assert.equal(countIds("111111,222222,111111"), parseIdList("111111,222222,111111").length);
assert.equal(countIds(process.env.GALAXY_MIND_RIG_IDS) > 0, true, "the test roster is not empty");
assert.equal(apiRigCount({ ourRigs: [{}, {}] }), 2);
assert.equal(apiRigCount({ ourRigs: [] }), 0, "empty roster reads 0 (the check fails)");
assert.equal(apiRigCount({}), -1, "missing field = unreadable (the check fails)");
assert.equal(apiRigCount(null), -1);
console.log("check-roster: 11 passed");
