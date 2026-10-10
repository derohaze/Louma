// Discord bot sketch: link a pending order to a checkout, grant a role only
// after verified settlement. Never grant on success_url redirect.
// Requires: discord.js, LOUMA_API_KEY, LOUMA_BASE_URL, PREMIUM_ROLE_ID.
import { randomUUID } from "node:crypto";
import { Client, GatewayIntentBits } from "discord.js";
import { LoumaClient } from "../sdk/javascript/index.js";

const louma = new LoumaClient({
  apiKey: process.env.LOUMA_API_KEY ?? "",
  baseURL: process.env.LOUMA_BASE_URL ?? "http://localhost:8000",
});
const pending = new Map(); // paymentId -> discordUserId (use a real DB in production)

const discord = new Client({ intents: [GatewayIntentBits.Guilds] });
discord.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "buy") return;
  const checkout = await louma.createCheckout(
    {
      subtotal: "10.0000",
      tax: "0.0000",
      currency: "LMA",
      description: `Premium for ${interaction.user.id}`,
      metadata: { discord_user: interaction.user.id },
    },
    randomUUID(),
  );
  const paymentId = checkout.payment_id ?? checkout.id;
  pending.set(paymentId, interaction.user.id);
  await interaction.reply(`Pay here: ${checkout.checkout_url ?? paymentId}\nRun /claim ${paymentId} after paying.`);
});

discord.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "claim") return;
  const paymentId = interaction.options.getString("payment", true);
  const payment = await louma.retrievePayment(paymentId); // authoritative record
  if (payment.status === "succeeded" && pending.get(paymentId) === interaction.user.id) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    await member.roles.add(process.env.PREMIUM_ROLE_ID);
    pending.delete(paymentId);
    await interaction.reply("Premium granted — payment verified.");
  } else {
    await interaction.reply(`Not settled yet (status: ${payment.status}).`);
  }
});

await discord.login(process.env.DISCORD_TOKEN);
