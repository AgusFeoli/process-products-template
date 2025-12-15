import * as SftpClientModule from "ssh2-sftp-client";
const SftpClient = SftpClientModule.default || SftpClientModule;
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

interface SftpConfig {
  host: string;
  user: string;
  password: string;
  port: number;
}

async function testSftpConnection() {
  console.log("=".repeat(50));
  console.log("🔌 TEST DE CONEXIÓN SFTP");
  console.log("=".repeat(50));

  // Get configuration
  const config: SftpConfig = {
    host: process.env.FTP_HOST || "",
    user: process.env.FTP_USER || "",
    password: process.env.FTP_PASSWORD || "",
    port: parseInt(process.env.FTP_PORT || "22", 10),
  };

  const imagesDir = process.env.FTP_IMAGES_DIR || "/";

  console.log("\n📋 Configuración:");
  console.log(`   Host: ${config.host || "(no configurado)"}`);
  console.log(`   Puerto: ${config.port}`);
  console.log(`   Usuario: ${config.user || "(no configurado)"}`);
  console.log(`   Password: ${config.password ? "********" : "(no configurado)"}`);
  console.log(`   Directorio de imágenes: ${imagesDir}`);

  // Validate configuration
  if (!config.host || !config.user) {
    console.log("\n❌ Error: Configuración SFTP incompleta.");
    console.log("   Asegurate de tener estas variables en tu .env:");
    console.log("   - FTP_HOST");
    console.log("   - FTP_USER");
    console.log("   - FTP_PASSWORD");
    console.log("   - FTP_PORT (opcional, default: 22 para SFTP)");
    console.log("   - FTP_IMAGES_DIR (opcional, default: /)");
    process.exit(1);
  }

  const client = new SftpClient();

  try {
    console.log("\n🔄 Conectando al servidor SFTP...");

    await client.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
    });

    console.log("\n✅ Conexión exitosa!");

    // Get current directory
    const pwd = await client.cwd();
    console.log(`\n📂 Directorio actual: ${pwd}`);

    // List files in images directory
    console.log(`\n📂 Listando archivos en: ${imagesDir}`);
    
    let files;
    try {
      files = await client.list(imagesDir);
    } catch (listError) {
      console.log(`\n❌ Error al listar directorio ${imagesDir}:`);
      console.log(`   ${listError instanceof Error ? listError.message : listError}`);
      console.log("\n💡 Verificá que el directorio exista. Listando directorio raíz...");
      files = await client.list("/");
      console.log("\n📂 Contenido del directorio raíz:");
      files.forEach((file, i) => {
        const type = file.type === "d" ? "📁" : "📄";
        console.log(`   ${i + 1}. ${type} ${file.name}`);
      });
      await client.end();
      process.exit(1);
    }

    console.log(`\n📊 Total de archivos/carpetas: ${files.length}`);

    // Filter and count images
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const imageFiles = files.filter((file) => {
      if (file.type !== "-") return false;
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      return imageExtensions.includes(ext);
    });

    const directories = files.filter((file) => file.type === "d");

    console.log(`   📁 Directorios: ${directories.length}`);
    console.log(`   🖼️  Imágenes: ${imageFiles.length}`);

    if (imageFiles.length > 0) {
      console.log("\n🖼️  Primeras 10 imágenes encontradas:");
      imageFiles.slice(0, 10).forEach((img, i) => {
        const sizeKB = (img.size / 1024).toFixed(1);
        console.log(`   ${i + 1}. ${img.name} (${sizeKB} KB)`);
      });

      if (imageFiles.length > 10) {
        console.log(`   ... y ${imageFiles.length - 10} más`);
      }
    }

    if (directories.length > 0) {
      console.log("\n📁 Subdirectorios encontrados:");
      directories.slice(0, 10).forEach((dir, i) => {
        console.log(`   ${i + 1}. ${dir.name}/`);
      });

      if (directories.length > 10) {
        console.log(`   ... y ${directories.length - 10} más`);
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ TEST COMPLETADO EXITOSAMENTE");
    console.log("=".repeat(50));

  } catch (error) {
    console.log("\n❌ Error de conexión SFTP:");
    if (error instanceof Error) {
      console.log(`   ${error.message}`);
    } else {
      console.log(`   ${error}`);
    }
    console.log("\n💡 Posibles causas:");
    console.log("   - Host o puerto incorrectos (SFTP usa puerto 22, no 21)");
    console.log("   - Credenciales inválidas");
    console.log("   - Firewall bloqueando la conexión");
    console.log("   - El servidor no está disponible");
    process.exit(1);
  } finally {
    await client.end();
    console.log("\n🔌 Conexión cerrada.");
  }
}

// Run the test
testSftpConnection();
