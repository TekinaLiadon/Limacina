package manifest

import (
	"Limacina/backend/utils"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type LoaderVersion struct {
	Loader struct {
		Version string `json:"version"`
		Stable  bool   `json:"stable"`
	} `json:"loader"`
	Maven     string `json:"maven"`
	Installer struct {
		Version string `json:"version"`
		Stable  bool   `json:"stable"`
	} `json:"installer"`
	Build int `json:"build"`
}

func GetFabric(mcVersion string) error {
	url := fmt.Sprintf("https://meta.fabricmc.net/v2/versions/loader/%s", mcVersion)
	resp, err := http.Get(url)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	var loaders []LoaderVersion
	if err := json.NewDecoder(resp.Body).Decode(&loaders); err != nil {
		panic(err)
	}
	if len(loaders) == 0 {
		panic("Нет доступных версий загрузчика для этой версии Minecraft")
	}

	basePath, err := utils.CheckDir()
	if err != nil {
		return err
	}
	loader := loaders

	loaderVer := loader[0].Loader.Version
	versionID := fmt.Sprintf("fabric-loader-%s-%s", loaderVer, mcVersion)

	jsonURL := fmt.Sprintf("https://meta.fabricmc.net/v2/versions/loader/%s/%s/profile/json", mcVersion, loaderVer)
	jarURL := fmt.Sprintf("https://maven.fabricmc.net/net/fabricmc/fabric-loader/%s/fabric-loader-%s.jar", loaderVer, loaderVer)

	versionDir := filepath.Join(basePath, versionID)
	if err := os.MkdirAll(versionDir, 0755); err != nil {
		panic(err)
	}

	jsonDst := filepath.Join(versionDir, versionID+".json")
	fmt.Println("Скачиваем:", jsonURL)
	if err := downloadFileFabric(jsonURL, jsonDst); err != nil {
		panic(err)
	}

	jarDst := filepath.Join(versionDir, versionID+".jar")
	fmt.Println("Скачиваем:", jarURL)
	if err := downloadFileFabric(jarURL, jarDst); err != nil {
		panic(err)
	}

	fmt.Println("Fabric Loader успешно скачан!")
	if err := downloadFabricLibraries(filepath.Join(versionDir, versionID+".json"), filepath.Join(basePath, "libraries")); err != nil {
		panic(err)
	}
	return nil
}

func downloadFileFabric(url, dst string) error {
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ошибка HTTP: %s", resp.Status)
	}

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

type FabricProfile struct {
	ID          string       `json:"id"`
	Time        string       `json:"time"`
	ReleaseTime string       `json:"releaseTime"`
	Type        string       `json:"type"`
	MainClass   string       `json:"mainClass"`
	JavaVersion *JavaVersion `json:"javaVersion,omitempty"`
	Arguments   *Arguments   `json:"arguments,omitempty"`
	// MinecraftArguments string  (для старых версий)
	MinimumLauncherVersion int               `json:"minimumLauncherVersion"`
	InheritsFrom           string            `json:"inheritsFrom,omitempty"`
	AssetIndex             *AssetIndexFabric `json:"assetIndex,omitempty"`
	Assets                 string            `json:"assets"`
	Downloads              *DownloadsFabric  `json:"downloads"`
	Libraries              []LibraryFabric   `json:"libraries"`
	Logging                *Logging          `json:"logging,omitempty"`
}

type JavaVersion struct {
	Component    string `json:"component"`
	MajorVersion int    `json:"majorVersion"`
}

type Arguments struct {
	Game []string `json:"game"`
	JVM  []string `json:"jvm"`
}

type Rule struct {
	Action   string          `json:"action"`
	OS       *RuleOS         `json:"os,omitempty"`
	Features map[string]bool `json:"features,omitempty"`
}

type RuleOS struct {
	Name    string `json:"name,omitempty"`
	Version string `json:"version,omitempty"`
	Arch    string `json:"arch,omitempty"`
}

type AssetIndexFabric struct {
	ID        string `json:"id"`
	SHA1      string `json:"sha1"`
	Size      int    `json:"size"`
	URL       string `json:"url"`
	TotalSize int    `json:"totalSize"`
}
type DownloadsFabric struct {
	Client DownloadLink `json:"client"`
	Server DownloadLink `json:"server"`
}
type DownloadLink struct {
	SHA1 string `json:"sha1"`
	Size int    `json:"size"`
	URL  string `json:"url"`
}

type LibraryFabric struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int    `json:"size"`
}

type LibDownloadsFabric struct {
	Artifact    *ArtifactFabric            `json:"artifact,omitempty"`
	Classifiers map[string]*ArtifactFabric `json:"classifiers,omitempty"`
}

type ArtifactFabric struct {
	Path string `json:"path"`
	URL  string `json:"url"`
	SHA1 string `json:"sha1"`
	Size int    `json:"size"`
}
type Extract struct {
	Exclude []string `json:"exclude"`
}

type Logging struct {
	Client *LoggingEntry `json:"client,omitempty"`
}

type LoggingEntry struct {
	Argument string      `json:"argument"`
	File     LoggingFile `json:"file"`
	Type     string      `json:"type"`
}

type LoggingFile struct {
	ID   string `json:"id"`
	SHA1 string `json:"sha1"`
	Size int    `json:"size"`
	URL  string `json:"url"`
}

func downloadFabricLibraries(jsonFilePath, librariesDir string) error {
	jsonData, err := os.ReadFile(jsonFilePath)
	if err != nil {
		return fmt.Errorf("ошибка чтения JSON-файла: %w", err)
	}

	var profile FabricProfile
	if err := json.Unmarshal(jsonData, &profile); err != nil {
		return fmt.Errorf("ошибка разбора JSON: %w", err)
	}

	if err := os.MkdirAll(librariesDir, 0755); err != nil {
		return fmt.Errorf("ошибка создания директории библиотек: %w", err)
	}

	fmt.Println("Скачивание библиотек Fabric...")
	for _, lib := range profile.Libraries {
		if lib.URL == "" {
			fmt.Printf("Пропуск библиотеки без URL: %s\n", lib.Name)
			continue
		}
		/*parts := strings.Split(lib.Name, ":")
		groupPath := strings.ReplaceAll(parts, ".", "/")
		artifact := parts[1]
		version := parts[2]
		jarPath := groupPath + "/" + artifact + "/" + version + "/" + artifact + "-" + version + ".jar"*/
		parts := strings.Split(lib.Name, ":")
		groupID := parts[0]
		artifactID := parts[1]
		version := parts[2]
		groupPath := strings.Replace(groupID, ".", string(filepath.Separator), -1)

		fileName := fmt.Sprintf("%s-%s.jar", artifactID, version)

		localPath := filepath.Join(librariesDir, groupPath, artifactID, version, fileName)

		urlPath := lib.URL + strings.ReplaceAll(groupID, ".", "/") + "/" + artifactID + "/" + version + "/" + artifactID + "-" + version + ".jar"

		fmt.Printf("Скачивание %s\n", lib.Name)
		if err := downloadFile(urlPath, localPath); err != nil {
			fmt.Printf("Ошибка скачивания %s: %v\n", lib.Name, err)
			continue
		}
	}

	fmt.Println("Все библиотеки Fabric успешно скачаны!")
	return nil
}
