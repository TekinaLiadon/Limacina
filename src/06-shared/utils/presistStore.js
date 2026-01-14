
export function saveStore(data, id) {
  const getStore = JSON.parse(localStorage.getItem(id));
  let store;
  if (getStore) store = Object.assign(getStore, data);
  else store = data;
  localStorage.setItem(id, JSON.stringify(store));
}

export function getStore(id) {
  return JSON.parse(localStorage.getItem(id));
}

export function removeStore(id) {
  localStorage.removeItem(id);
}
