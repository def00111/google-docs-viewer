"use strict";
const {storage} = browser;

async function saveOptions(e) {
  let result = await storage.local.get("enabled_file_exts");
  if (e.target.checked) {
    if (result.hasOwnProperty("enabled_file_exts")) {
      result["enabled_file_exts"].push(e.target.id);
      storage.local.set({
        "enabled_file_exts": result["enabled_file_exts"],
      });
    }
    else {
      storage.local.set({
        "enabled_file_exts": [e.target.id],
      });
    }
  }
  else {
    if (result.hasOwnProperty("enabled_file_exts")) {
      storage.local.set({
        "enabled_file_exts": result["enabled_file_exts"].filter(fileExt => fileExt != e.target.id),
      });
    }
  }
}

async function restoreOptions(e) {
  let checkboxes = document.querySelectorAll('input[type="checkbox"]');
  for (let checkbox of checkboxes) {
    checkbox.addEventListener("click", saveOptions);
  }

  let results = await storage.local.get(null);
  if (results.hasOwnProperty("enabled_file_exts")) {
    for (let checkbox of checkboxes) {
      checkbox.checked = results["enabled_file_exts"].includes(checkbox.id);
    }
  }
}

document.addEventListener("DOMContentLoaded", restoreOptions);
