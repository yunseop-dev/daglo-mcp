import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import {
  getAuthStatus,
  loginUser,
  logoutUser,
} from "../handlers/auth.js";
import {
  writeJson,
  writeKeyValue,
  writeSuccess,
} from "./render/format.js";
import { promptCredentials } from "./prompt.js";

export const registerAuthCommand = (program: Command, client: DagloApiClient) => {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("login")
    .description("Log in to Daglo and cache tokens")
    .option("--email <email>", "Daglo account email")
    .option("--password <password>", "Daglo account password")
    .option("--json", "output JSON")
    .action(async (opts) => {
      let { email, password } = opts;
      email = email ?? process.env.DAGLO_EMAIL;
      password = password ?? process.env.DAGLO_PASSWORD;

      if (!email || !password) {
        const prompted = await promptCredentials({ email });
        email = email ?? prompted.email;
        password = prompted.password;
      }

      await loginUser(client, { email, password });
      if (opts.json) {
        writeJson({ loggedIn: true, email });
      } else {
        writeSuccess(`Logged in as ${email}`);
      }
    });

  auth
    .command("logout")
    .description("Delete cached credentials")
    .option("--json", "output JSON")
    .action((opts) => {
      logoutUser();
      if (opts.json) writeJson({ loggedOut: true });
      else writeSuccess("Logged out");
    });

  auth
    .command("status")
    .description("Show current login status")
    .option("--json", "output JSON")
    .action((opts) => {
      const status = getAuthStatus();
      if (opts.json) {
        writeJson(status);
        if (!status.loggedIn) process.exit(1);
        return;
      }
      if (!status.loggedIn) {
        process.stderr.write("Not logged in\n");
        process.exit(1);
      }
      writeKeyValue([
        ["Email", status.email ?? "(unknown)"],
        ["Expires", status.expiresAt ?? "(no expiry recorded)"],
      ]);
    });
};
