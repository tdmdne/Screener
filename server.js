const path = require("path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

app.use(
  express.static(__dirname, {
    dotfiles: "ignore",
    index: ["index.html"],
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Vektor Terminal listening on http://${HOST}:${PORT}`);
});
