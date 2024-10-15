
var arrayExample = new Uint32Array(5);
function makeid(length) {
    let result = "";
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function formatMoney(amount) {
    if (amount === undefined) return undefined;
    if (!+amount) return 0;

    return new Intl.NumberFormat("ru-RU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
        useGrouping: true,
    }).format(Math.floor(amount)).replace(/\s/g, '.');
}


export function formatNumberCompact(number, fraction = 3) {
    return new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: fraction,
    }).format(number);
}

export const randomId = () => {
    window.crypto.getRandomValues(arrayExample);
    return `re${
        arrayExample[Math.floor(Math.random() * arrayExample.length)]
    }${makeid(2)}`;
};

