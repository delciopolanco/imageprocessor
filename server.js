const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const mime = require("mime-types");
const { Blob } = require("buffer");
const { google } = require("googleapis");

const keyFile = path.join(__dirname, "./", "credentials.json");

const auth = new google.auth.GoogleAuth({
  keyFile: keyFile,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

const drive = google.drive({ version: "v3", auth });

const app = express();
app.use(bodyParser.json());

const tempDir = path.join(__dirname, "./temp");
fs.ensureDirSync(tempDir);

async function downloadImage(url, tempFilePath) {
  try {
    const response = await axios.get(url, { responseType: "stream" });
    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
    return tempFilePath;
  } catch (error) {
    throw new Error(`Error donwloading image: ${error.message}`);
  }
}

async function uploadToGoogleDrive(tempFilePath) {
  try {
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`File not found: ${tempFilePath}`);
    }

    const image = fs.createReadStream(tempFilePath);
    const mimeType = mime.lookup(tempFilePath);

    const name = path.basename(tempFilePath);

    const fileMetadata = {
      name: name,
      parents: ["1Bdq-PXUWa3L5BYD89yKn1q1CWHoYgHV6"],
    };

    const media = {
      mimeType,
      body: image,
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });

    return file.data.id;
  } catch (error) {
    throw new Error(`Error uploading image to Google Drive: ${error}`);
  }
}

async function performOCR(tempFilePath) {
  try {
    if (!tempFilePath) throw new Error(`Error performing OCR: ${error}`);

    const apiKey = "donotstealthiskey_ip1";
    const formData = new FormData();
    const data = [];

    const fileStream = fs.createReadStream(tempFilePath);
    const mimeType = mime.lookup(tempFilePath);
    const filePromise = new Promise((resolve, reject) => {
      const chunks = [];
      fileStream.on("data", (chunk) => chunks.push(chunk));
      fileStream.on("end", () => resolve(Buffer.concat(chunks)));
      fileStream.on("error", reject);
    });

    const image = await filePromise;
    const blob = new Blob([image], { type: mimeType });

    formData.append("file", blob);
    formData.append("url", "");
    formData.append("language", "eng");
    formData.append("isOverlayRequired", "true");
    formData.append("FileType", ".Auto");
    formData.append("IsCreateSearchablePDF", "false");
    formData.append("isSearchablePdfHideTextLayer", "true");
    formData.append("detectOrientation", "false");
    formData.append("isTable", "false");
    formData.append("scale", "true");
    formData.append("OCREngine", "1");
    formData.append("detectCheckbox", "false");
    formData.append("checkboxTemplate", "0");

    const response = await axios.postForm(
      "https://api8.ocr.space/parse/image",
      formData,
      {
        headers: {
          apikey: apiKey,
        },
      }
    );

    if (response?.data && !!response.data.ErrorMessage?.length)
      throw new Error(response.data.ErrorMessage);

    response.ParsedResults?.forEach((response) => {
      data.push(response.ParsedText.join("\r\n"));
    });

    return data;
  } catch (error) {
    throw new Error(`Error performing OCR: ${error}`);
  }
}

function deleteTempFile(tempFilePath) {
  try {
    fs.unlinkSync(tempFilePath);
  } catch (error) {
    console.error(`Error trying to delete the temp file: ${error.message}`);
  }
}

async function processImage(urlTempFile) {
  try {
    const tempFilePath = path.join(tempDir, `temp_${Date.now()}.jpg`);
    await downloadImage(urlTempFile, tempFilePath);

    const fileId = await uploadToGoogleDrive(tempFilePath);

    // TODO: Fix issue of invalid file type in OCR
    // const extractedText = await performOCR(tempFilePath);

    deleteTempFile(tempFilePath);

    await drive.files.delete({ fileId });

    return extractedText;
  } catch (error) {
    throw new Error(`Error procesing image: ${error.message}`);
  }
}

app.post("/process-image", async (req, res) => {
  try {
    const data = req.body;

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "Invalid data." });
    }

    const results = [];
    for (const item of data) {
      const urlTempFile = item.context.urlTempFile;

      if (!urlTempFile) {
        results.push({
          error: "URL was not found.",
        });
        continue;
      }

      try {
        const extractedText = await processImage(urlTempFile);

        // Agregar resultado al arreglo de respuestas
        results.push({ imageUrl: urlTempFile, extractedText });
      } catch (error) {
        results.push({ imageUrl: urlTempFile, error: error.message });
      }
    }

    return res.status(200).json(results);
  } catch (error) {
    return res.status(500).json({ error: "Internal server error." });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
