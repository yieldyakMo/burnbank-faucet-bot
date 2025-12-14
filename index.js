require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const { ethers } = require("ethers");

// ================= CONFIG =================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const RPC_URL = process.env.RPC_URL;
const BBNK_TOKEN = process.env.BBNK_TOKEN; // must be a 0x... token contract address
const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY;

const FAUCET_AMOUNT = process.env.FAUCET_AMOUNT || "500";
const COOLDOWN_HOURS = Number(process.env.COOLDOWN_HOURS || "24");

const COOLDOWN_FILE = path.join(__dirname, "cooldowns.json");

// ================= CLIENT =================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ================= HELPERS =================
function loadCooldowns() {
  if (!fs.existsSync(COOLDOWN_FILE)) return {};
  return JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf8"));
}

function saveCooldowns(data) {
  fs.writeFileSync(COOLDOWN_FILE, JSON.stringify(data, null, 2));
}

function requireEnv(name, value) {
  if (!value) {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

// ================= BLOCKCHAIN =================
requireEnv("RPC_URL", RPC_URL);
requireEnv("BBNK_TOKEN", BBNK_TOKEN);
requireEnv("FAUCET_PRIVATE_KEY", FAUCET_PRIVATE_KEY);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(FAUCET_PRIVATE_KEY, provider);

const erc20Abi = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const token = new ethers.Contract(BBNK_TOKEN, erc20Abi, wallet);

// ================= COMMAND =================
const faucetCommand = new SlashCommandBuilder()
  .setName("faucet")
  .setDescription("Claim BurnBank (BBNK) tokens")
  .addStringOption((opt) =>
    opt
      .setName("address")
      .setDescription("Your wallet address (0x...)")
      .setRequired(true)
  );

// ================= REGISTER =================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
    body: [faucetCommand.toJSON()],
  });

  console.log("✅ Slash commands registered");
}

// ================= INTERACTION =================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "faucet") return;

  const userId = interaction.user.id;
  const cooldowns = loadCooldowns();
  const now = Date.now();

  // Cooldown check (keyed by Discord user id)
  if (cooldowns[userId]) {
    const elapsed = (now - cooldowns[userId]) / (1000 * 60 * 60);
    if (elapsed < COOLDOWN_HOURS) {
      const remaining = (COOLDOWN_HOURS - elapsed).toFixed(1);
      return interaction.reply({
        content: `⏳ You must wait ${remaining} more hours before using the faucet again.`,
        ephemeral: true,
      });
    }
  }

  // Get & validate wallet address
  const to = interaction.options.getString("address", true).trim();

  if (!ethers.isAddress(to)) {
    return interaction.reply({
      content: "❌ Invalid address. Please provide a valid 0x... wallet address.",
      ephemeral: true,
    });
  }

  try {
    await interaction.deferReply({ ephemeral: true });

    const decimals = await token.decimals();
    const amount = ethers.parseUnits(FAUCET_AMOUNT, decimals);

    const tx = await token.transfer(to, amount);
    await tx.wait();

    cooldowns[userId] = now;
    saveCooldowns(cooldowns);

    await interaction.editReply(
      `🔥 **${FAUCET_AMOUNT} BBNK** sent to:\n\`${to}\`\nTx: ${tx.hash}`
    );
  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ Faucet error. Please try again later.");
  }
});

// ================= START =================
(async () => {
  requireEnv("DISCORD_TOKEN", DISCORD_TOKEN);
  requireEnv("DISCORD_CLIENT_ID", DISCORD_CLIENT_ID);

  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
