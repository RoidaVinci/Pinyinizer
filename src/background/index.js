// MV3 service worker entry.
import "./messaging.js";
import { getSettings } from "./storage/settings.js";
import { updateBadge } from "./badge.js";

async function refreshBadge() {
  updateBadge(await getSettings());
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);
