package minecraft

import (
	"Limacina/backend/utils"
	"fmt"
	"log"
	"os"
	"os/exec"
)

func StartJvm(username string, uuid string, accessToken string) (string, error) {
	dir, err := utils.CheckDir()
	if err != nil {
		return "", err
	}
	libraries := dir + `/test/updates/StargazerPrologue/libraries`
	forge := dir + `/test/updates/StargazerPrologue/libraries/net/minecraftforge/forge/forge-1.16.5-36.2.39-client.jar`
	mc := dir + "/test/updates/StargazerPrologue/minecraft.jar"
	classpath, err := GetClasspath(libraries, forge, mc)
	if err != nil {
		return "", fmt.Errorf("Не удалось собрать библиотеки форджа: %w", err)
	}

	minecraftArgs := []string{
		"--tweakClass", "net.minecraftforge.fml.common.launcher.FMLTweaker", "--username", username,
		"--uuid", uuid,
		"--accessToken", accessToken,
		"--userType", "mojang",
		"--userProperties", `{"skinURL":["http://localhost:5551/skins/Break.png"],"skinDigest":["d42bb75b95901a5a486c1fda9e5e8eaed764b0c9a746b4c1aa7311b07475bafb"]}`,
		"--assetIndex", "1.16.5",
		"--version", "1.16.5",
		"--assetsDir", dir + `/test/updates/asset1.16.5`,
		"--resourcePackDir", dir + `/test/updates/StargazerPrologue/resourcepacks`,
		"--versionType", "KJ-Launcher v1.7.5.2",
		"--launchTarget", "fmlclient",
		"--fml.forgeVersion", "36.2.39",
		"--fml.mcVersion", "1.16.5",
		"--fml.forgeGroup", "net.minecraftforge",
		"--fml.mcpVersion", "20210115.111550",
	}
	args := []string{fmt.Sprintf("-Xmx%s", "4G"), "-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20", "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M", "--version", "1.16.5", "-cp", classpath, "net.minecraft.launchwrapper.Launch"}

	args = append(args, minecraftArgs...)
	cmd := exec.Command("java", args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	errCmd := cmd.Start()
	if errCmd != nil {
		return "", fmt.Errorf("Не удалось запустить игру: %w", err)
	}

	go func() {
		err := cmd.Wait()
		if err != nil {
			log.Printf("Процесс игры завершился с ошибкой: %w", err)
		} else {
			log.Println("Процесс игры успешно завершен")
		}
	}()

	return "", nil
}

//args := []string{"-jar", a.CheckDir() + "/test/updates/StargazerPrologue/minecraft.jar", "-Xmx4G", "-XX:+UnlockExperimentalVMOptions", "-XX:+UseG1GC", "-XX:G1NewSizePercent=20", "-XX:G1ReservePercent=20", "-XX:MaxGCPauseMillis=50", "-XX:G1HeapRegionSize=32M", "--version", "1.16.5", "/test/updates/StargazerPrologue/minecraft.jar"}
//cmd := exec.Command("java", args...)
// "--gameDir", a.CheckDir() + `/test/updates/StargazerPrologue`,
// fmt.Printf("Executing: %s %s\n", a.CheckDir()+"/test/updates/graalvm-11-win64/bin/java", strings.Join(args, " "))
