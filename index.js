require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const { ethers } = require("ethers");

// ================= CONFIG =================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const RPC_URL = process.env.RPC_URL;
const BBNK_TOKEN = process.env.BBNK_TOKEN;
const FAUCET_PRIVATE_KEY = process.env.FAUCET_PRIVATE_KEY;

const FAUCET_AMOUNT = process.env.FAUCET_AMOUNT || "500";
const COOLDOWN_HOURS = Number(process.env.COOLDOWN_HOURS || "24");
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

const CLAIMS_FILE = path.join(__dirname, "claims.json");

// =============== ERC20 ABI ===============
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// =============== HELPERS ==================
function loadClaims() {
  if (!fs.existsSync(CLAIMS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CLAIMS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveClaims(data) {
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(data, null, 2));
}

function isValidAddress(addr) {
  try {
    return ethers.isAddress(addr);
  } catch {
    return false;
  }
}

function shorten(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ============== BLOCKCHAIN ===============
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = new ethers.Wallet(FAUCET_PRIVATE_KEY, provider);
const token = new ethers.Contract(BBNK_TOKEN, ERC20_ABI, signer);

// ============== DISCORD ==================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const faucetCommand = new SlashCommandBuilder()
  .setName("faucet")
  .setDescription("Claim BBNK from the BurnBank faucet")
  .addStringOption((opt) =>
    opt.setName("wallet").setDescription("Your wallet address").setRequired(true)
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
    body: [faucetCommand.toJSON()],
  });
  console.log("✅ Slash command registered");
}

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

  client.on("interactionCreate", async (interaction) => {
  const ALLOWED_CHANNEL_ID = "1449497696351158293";

if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
  // block
}
    await interaction.reply({
      content: "❌ Please use the faucet in #faucet only.",
      ephemeral: true,
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "faucet") return;

  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.options.getString("wallet");


  if (!isValidAddress(wallet)) {
    return interaction.editReply("❌ Invalid wallet address.");
  }

  const claims = loadClaims();
  const last = claims[wallet]?.last || 0;

  if (Date.now() - last < COOLDOWN_MS) {
    return interaction.editReply("⏳ Faucet cooldown active. Try again later.");
  }

  try {
    const decimals = await token.decimals();
    const amount = ethers.parseUnits(FAUCET_AMOUNT, decimals);

    const tx = await token.transfer(wallet, amount);

    claims[wallet] = { last: Date.now(), tx: tx.hash };
    saveClaims(claims);

    await interaction.editReply(
      `🔥 Sent **${FAUCET_AMOUNT} BBNK** to ${shorten(wallet)}\n` +
      `Tx: https://monadvision.com/tx/${tx.hash}`
    );
  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ Faucet transaction failed.");
  }
});

// ============== START ==================
(async () => {
  if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
    console.error("❌ Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env");
    process.exit(1);
  }
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();

