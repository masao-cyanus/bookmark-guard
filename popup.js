const lockToggle = document.getElementById("lockToggle");

browser.runtime.sendMessage({ action: "getState" }).then((state) => {
  lockToggle.checked = state.locked;
});

lockToggle.onchange = () => {
  browser.runtime.sendMessage({
    action: "updateLock",
    value: lockToggle.checked,
  });
};
