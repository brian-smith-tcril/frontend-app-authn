import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.static("runtime-config"));

app.listen(11999, () => {
  console.log("Serving runtime config at http://localhost:11999");
});
