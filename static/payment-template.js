(() => {
    const card = document.getElementById("checkoutCard");
    const payButton = document.getElementById("payButton");
    const successPanel = document.getElementById("successPanel");

    if (!card || !payButton || !successPanel) {
        return;
    }

    let state = "idle";

    payButton.addEventListener("click", () => {
        if (state !== "idle") {
            return;
        }

        state = "processing";
        payButton.disabled = true;
        payButton.classList.add("is-processing");
        payButton.setAttribute("aria-busy", "true");

        window.setTimeout(() => {
            state = "success";
            card.classList.add("is-success");
            payButton.classList.remove("is-processing");
            payButton.setAttribute("aria-busy", "false");
            successPanel.setAttribute("aria-hidden", "false");
        }, 900);
    });
})();

