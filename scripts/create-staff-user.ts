// One-off admin script to provision a staff login (CLAUDE.md §2: accounts
// are admin-provisioned, no self-serve signup). Uses the Supabase Admin API
// with phone_confirm: true, so no SMS is ever sent.
//
// Run with: npm run create:staff-user -- <phone> <password> "<full name>" <admin|packer|delivery>

import { createServiceRoleClient } from "../src/lib/supabase/service-role";
import { toE164 } from "../src/lib/phone";
import type { Role } from "../src/lib/supabase/database.types";

const VALID_ROLES: Role[] = ["admin", "packer", "delivery"];

async function main() {
  const [phoneArg, password, fullName, role] = process.argv.slice(2);
  if (!phoneArg || !password || !fullName || !role) {
    console.error('Usage: npm run create:staff-user -- <phone> <password> "<full name>" <admin|packer|delivery>');
    process.exitCode = 1;
    return;
  }
  if (!VALID_ROLES.includes(role as Role)) {
    console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (password.length < 6) {
    console.error("Password must be at least 6 characters (Supabase's default minimum).");
    process.exitCode = 1;
    return;
  }

  const phone = toE164(phoneArg);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) {
    console.error(`Failed to create auth user: ${error?.message}`);
    process.exitCode = 1;
    return;
  }

  // handle_new_user() (0001_profiles.sql) already inserted a profiles row
  // with role: null -- set the real role now.
  const { error: roleError } = await supabase
    .from("profiles")
    .update({ role: role as Role })
    .eq("id", data.user.id);
  if (roleError) {
    console.error(`User created (id: ${data.user.id}) but failed to set role: ${roleError.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Created ${role}: ${fullName} (${phone})`);
}

main();
