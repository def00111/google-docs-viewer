"use strict";
const {contextMenus, downloads, i18n, runtime, storage, tabs, webRequest} = browser;

const TEXT_HTML_REGEXP = /^\s*text\/html(?:;.*|\s*)?$/i;

// https://www.npmjs.com/package/base64-regex
const BASE64_REGEXP = /(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)/;

// https://stackoverflow.com/questions/23054475/javascript-regex-for-extracting-filename-from-content-disposition-header/23054920
const FILENAME_REGEXP = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i;

// https://dxr.mozilla.org/mozilla-central/source/netwerk/base/nsNetUtil.cpp#2389
const DISPOSITION_INLINE_REGEXP = /^\s*(?:inline(?:;.*|\s*)?|filename.*|)$/i;

let ignoreOnceUrls = new Map();
let filenames = new Map();

let ellipsis = "\u2026";

let options = {
  "enabled_file_exts": [],
};

storage.onChanged.addListener((changes, area) => {
  if (changes.hasOwnProperty("enabled_file_exts")) {
    options["enabled_file_exts"] = changes["enabled_file_exts"].newValue;
  }
});

storage.local.get(null).then(items => {
  if (items.hasOwnProperty("enabled_file_exts")) {
    options["enabled_file_exts"] = items["enabled_file_exts"];
  }
});

let validExts = [
  "xls", "xlt", "xla", "xltx", "xlsx", "xlsb", "xlsm", "xlam", "xltm",
  "doc", "dot", "docx", "dotx", "docm", "dotm", "rtf",
  "ppt", "pps", "pot", "ppa", "pptx", "ppsx", "potx", "ppam", "pptm", "potm", "ppsm",
  "odt", "ods", "odp"
].join("|");

let validExtsRe1 = new RegExp(`\\.(${validExts})$`, "i");
let validExtsRe2 = new RegExp(`^[^?#;]+\\.(${validExts})(?=$|[#?;])`, "i");

let events = ["onCompleted", "onErrorOccurred", "onBeforeRedirect"];

// http://filext.com/faq/office_mime_types.php
function getFileExtensionForType(contentType) {
  if (contentType.includes(";")) {
    contentType = contentType.split(";", 1)[0];
  }
  contentType = contentType.replace(/ /g, ""); // remove any whitespace

  switch (contentType) {
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.template":
      return "dotx";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "application/vnd.ms-excel.sheet.macroEnabled.12":
      return "xlsm";
    case "application/vnd.ms-excel.sheet.binary.macroEnabled.12":
      return "xlsb";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "application/vnd.openxmlformats-officedocument.presentationml.slideshow":
      return "ppsx";
    case "application/vnd.ms-word.document.macroEnabled.12":
      return "docm";
    case "application/vnd.ms-word.template.macroEnabled.12":
      return "dotm";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.template":
      return "xltx";
    case "application/vnd.ms-excel.addin.macroEnabled.12":
      return "xlam";
    case "application/vnd.openxmlformats-officedocument.presentationml.template":
      return "potx";
    case "application/vnd.ms-powerpoint.addin.macroEnabled.12":
      return "ppam";
    case "application/vnd.ms-powerpoint.presentation.macroEnabled.12":
      return "pptm";
    case "application/vnd.ms-powerpoint.template.macroEnabled.12":
      return "potm";
    case "application/vnd.ms-powerpoint.slideshow.macroEnabled.12":
      return "ppsm";
    case "application/vnd.oasis.opendocument.text":
      return "odt";
    case "application/vnd.oasis.opendocument.spreadsheet":
      return "ods";
    case "application/vnd.oasis.opendocument.presentation":
      return "odp";
    case "application/vnd.ms-excel.template.macroEnabled.12":
      return "xltm";
    case "application/rtf":
    case "application/x-rtf":
      return "rtf";
    default:
      return "";
  }
}

function addListeners(filter) {
  for (let event of events) {
    webRequest[event].addListener(check, filter);
  }
}

function removeListeners() {
  for (let event of events) {
    if (webRequest[event].hasListener(check)) {
      webRequest[event].removeListener(check);
    }
  }
}

function check(details) {
  if (filenames.has(details.url)) {
    if (details.redirectUrl) {
      filenames.set(details.redirectUrl, filenames.get(details.url));
    }
    filenames.delete(details.url);
  }
  else if (ignoreOnceUrls.has(details.url)) {
    if (details.redirectUrl) {
      ignoreOnceUrls.set(details.redirectUrl, true);
    }
    ignoreOnceUrls.delete(details.url);
  }
  removeListeners();

  if (details.redirectUrl) {
    addListeners({
      urls: [details.redirectUrl],
      tabId: details.tabId
    });
  }
}

runtime.onMessage.addListener((message, sender) => {
  if (!(message.url && sender.tab)) {
    return;
  }

  let url = message.url;
  if (ignoreOnceUrls.has(url)) {
    return;
  }

  if (filenames.has(url)) {
    return;
  }

  if (!message.hasOwnProperty("filename")) {
    ignoreOnceUrls.set(url, true);
  }
  else {
    filenames.set(url, message.filename);
  }

  addListeners({
    urls: [url],
    tabId: sender.tab.id
  });
});

contextMenus.onClicked.addListener(async (info, tab) => {
  let params = new URLSearchParams(info.frameUrl.split("?")[1]);
  let url = params.get("url");

  let filename;
  let fileExt = params.get("fext");
  let hasFileExt = str => str.split(".").pop().toLowerCase() == fileExt;
  if (params.has("fname")) {
    filename = params.get("fname");
  }
  else {
    let m = url.match(/([^\/?#;]+)(?=$|[?#;])/);
    if (m != null && m.length > 1) {
      filename = m[1];
    }

    if ((!filename || !hasFileExt(filename)) && url.includes("?")) {
      let params = new URLSearchParams(url.split("?")[1]);
      for (let value of params.values()) {
        if (hasFileExt(value)) {
          filename = value;
          break;
        }
        else {
          let m = FILENAME_REGEXP.exec(value);
          if (m != null && m.length > 1) {
            if (m[0].toLowerCase().startsWith("filename*")) {
              filename = m[1].replace(/^.+'.*'/, "");
            }
            else {
              filename = m[1].replace(/^\s*\\?['"]?/, "").replace(/\\?['"]?\s*$/, "");
            }

            if (filename != "" && BASE64_REGEXP.test(filename)) {
              filename = atob(BASE64_REGEXP.exec(filename)[0]);
            }
            break;
          }
        }
      }
    }
  }

  if (typeof filename == "string") {
    if (/%[0-9A-Fa-f]{2}/.test(filename)) {
      try {
        filename = decodeURIComponent(filename);
      }
      catch (ex) {
      }
    }

    if (!hasFileExt(filename)) {
      filename += "." + fileExt;
    }

    if (/[\/\\|"*?:<>]/.test(filename)) {
      let platformInfo = await runtime.getPlatformInfo();
      if (platformInfo.os == "win") { // fix error on windows
        filename = filename.replace(/[\/\\|"*?:<>]/g, "_");
      }
    }
  }
  else {
    filename = `document.${fileExt}`;
  }

  downloads.download({
    url,
    filename,
    saveAs: true
  }).catch(error => {
    if (error.message != "Download canceled by the user") {
      throw error; // only display important errors :)
    }
  });
});

contextMenus.create({
  id: "context-savefile",
  title: i18n.getMessage("contextMenuItemSaveFile") + ellipsis,
  contexts: ["page", "frame"],
  documentUrlPatterns: [
    "https://docs.google.com/viewer?url=*&fext=*",
    "https://docs.google.com/viewerng/viewer?url=*&fext=*"
  ]
});

function processHeaders(details) {
  if (details.tabId == tabs.TAB_ID_NONE || details.method !== "GET") {
    return;
  }

  if (details.url.startsWith("https://docs.google.com/")) {
    if (details.url.includes("viewer?url=", 24) ||
        details.url.includes("viewerng/viewer?url=", 24)) {
      // weird bug
      if (details.statusCode == 204) {
        return {
          redirectUrl: details.url
        };
      }
    }
    return;
  }

  if (details.statusCode !== 200) {
    return;
  }

  if (details.url.includes("viewer.googleusercontent.com/viewer/secure/pdf/") ||
      details.url.startsWith("https://accounts.google.com/") ||
      details.url.startsWith("https://clients6.google.com/") ||
      details.url.startsWith("https://content.googleapis.com/")) {
    return;
  }

  let contentTypeHeader = null;
  let contentDispositionHeader = null;
  for (let header of details.responseHeaders) {
    switch (header.name.toLowerCase()) {
      case "content-disposition":
        contentDispositionHeader = header;
        break;
      case "content-type":
        contentTypeHeader = header;
        break;
    }
  }

  let contentDisposition;
  if (contentDispositionHeader &&
      contentDispositionHeader.value) {
    contentDisposition = contentDispositionHeader.value;
  }

  let contentType;
  if (contentTypeHeader &&
      contentTypeHeader.value) {
    contentType = contentTypeHeader.value;
  }

  if (details.type != "main_frame" &&
      typeof contentDisposition == "string" &&
      !DISPOSITION_INLINE_REGEXP.test(contentDisposition)) {
    return;
  }

  let filename = "", isAttachment = false;
  if (filenames.has(details.url)) {
    isAttachment = true; // there is a download attribute

    let value = "attachment";
    if (filenames.get(details.url) != "") {
      filename = filenames.get(details.url);
      value += `; filename="${filename}"`;
    }
    details.responseHeaders.push({ name: "Content-Disposition", value });
    filenames.delete(details.url);
  }

  if (!filename && typeof contentDisposition == "string") {
    let m = FILENAME_REGEXP.exec(contentDisposition);
    if (m != null && m.length > 1) {
      if (m[0].toLowerCase().startsWith("filename*")) {
        filename = m[1].replace(/^.+'.*'/, "");
        try {
          filename = decodeURIComponent(filename);
        }
        catch (ex) {
        }
      }
      else {
        if (/%[0-9A-Fa-f]{2}/.test(m[1])) {
          try {
            filename = decodeURIComponent(m[1]);
          }
          catch (ex) {
            filename = m[1];
          }
        }
        else {
          filename = m[1].replace(/^\s*\\?['"]?/, "").replace(/\\?['"]?\s*$/, "");
        }

        if (filename != "") {
          if (/\s/.test(filename) && (!m[2] || m[2] != "\"")) {
            // fix firefox bug :(
            // https://bugzilla.mozilla.org/show_bug.cgi?id=221028
            contentDisposition = contentDisposition.replace(m[1], `"${filename}"`);
          }

          if (BASE64_REGEXP.test(filename)) {
            filename = atob(BASE64_REGEXP.exec(filename)[0]);
          }
        }
      }
    }
  }

  if (ignoreOnceUrls.has(details.url)) {
    ignoreOnceUrls.delete(details.url);

    if (contentDispositionHeader != null) {
      if (contentDisposition) {
        if (/^\s*inline/i.test(contentDisposition)) {
          contentDisposition = contentDisposition.replace(/^\s*inline/i, "attachment");
        }
        else if (/^\s*filename/i.test(contentDisposition)) {
          contentDisposition = contentDisposition.replace(/^\s*(filename)/i, "attachment; $1");
        }
        contentDispositionHeader.value = contentDisposition;
      }
    }
    else {
      details.responseHeaders.push({ name: "Content-Disposition", value: "attachment" });
    }

    return {
      responseHeaders: details.responseHeaders
    };
  }

  let fileExt = contentType ? getFileExtensionForType(contentType) : "";
  if (!fileExt && filename != "") {
    let m = validExtsRe1.exec(filename);
    if (m != null && m.length > 1) {
      fileExt = m[1].toLowerCase();
    }
  }

  let isHTML = contentType && TEXT_HTML_REGEXP.test(contentType) || false;
  if (!fileExt && !isHTML) {
    let m = validExtsRe2.exec(details.url);
    if (m != null && m.length > 1) {
      fileExt = m[1].toLowerCase();
    }
  }

  let fileExts = [];
  if (!fileExt && typeof contentType == "string") {
    if (contentType.includes(";")) {
      contentType = contentType.split(";", 1)[0];
    }
    contentType = contentType.replace(/ /g, ""); // remove any whitespace

    switch (contentType) {
      case "application/msword":
        fileExts = ["doc", "dot", "rtf"];
        break;
      case "application/vnd.ms-powerpoint":
        fileExts = ["ppt", "pot", "pps", "ppa"];
        break;
      case "application/vnd.ms-excel":
        fileExts = ["xls", "xlt", "xla"];
        break;
    }
  }

  let ok = false;
  if (fileExt && options["enabled_file_exts"].includes(fileExt)) {
    ok = true;
  }
  else if (fileExts.some(fileExt => options["enabled_file_exts"].includes(fileExt))) {
    ok = true;
  }

  if (!ok) {
    if (isAttachment != false) {
      return {
        responseHeaders: details.responseHeaders
      };
    }
    return;
  }

  let redirectUrl = "https://docs.google.com/viewer";
  try {
    redirectUrl += `?url=${encodeURIComponent(details.url)}`;
  }
  catch (ex) {
    redirectUrl += `?url=${details.url}`;
  }

  if (filename != "") {
    try {
      redirectUrl += `&fname=${encodeURIComponent(filename)}`;
    }
    catch (ex) {
      redirectUrl += `&fname=${filename}`;
    }
  }
  redirectUrl += `&fext=${fileExt}`;

  if (details.type != "main_frame") {
    redirectUrl += "&embedded=true";
    return {redirectUrl};
  }

  return new Promise(async resolve => {
    let tab = await tabs.get(details.tabId);
    if (/^wyciwyg:\/{2}\d+\//.test(tab.url)) {
      let url = tab.url.replace(/^wyciwyg:\/{2}\d+\//, "");
      if (url.startsWith("https://docs.google.com/viewer?url=") ||
          url.startsWith("https://docs.google.com/viewerng/viewer?url=")) {
        if (typeof contentDisposition == "string" &&
            contentDispositionHeader.value != contentDisposition) {
          contentDispositionHeader.value = contentDisposition;
          resolve({responseHeaders: details.responseHeaders});
        }
        else {
          resolve();
        }
      }
      else {
        resolve({redirectUrl});
      }
    }
    else {
      resolve({redirectUrl});
    }
  });
}

webRequest.onHeadersReceived.addListener(
  processHeaders,
  {urls: ["*://*/*"], types: ["main_frame", "sub_frame", "object"]},
  ["blocking", "responseHeaders"]
);
