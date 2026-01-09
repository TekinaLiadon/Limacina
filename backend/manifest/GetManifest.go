package manifest

import (
	"Limacina/backend/utils"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

type VersionsIndexManifest struct {
	Latest struct {
		Release  string `json:"release"`
		Snapshot string `json:"snapshot"`
	} `json:"latest"`
	Versions []struct {
		ID          string `json:"id"`
		Type        string `json:"type"`
		URL         string `json:"url"`
		Time        string `json:"time"`
		ReleaseTime string `json:"releaseTime"`
	} `json:"versions"`
}

type VersionDetailsManifest struct {
	ID                 string      `json:"id"`
	Downloads          Downloads   `json:"downloads"`
	Libraries          []Library   `json:"libraries"`
	AssetIndex         AssetIndex  `json:"assetIndex"`
	Assets             string      `json:"assets"`
	MainClass          string      `json:"mainClass"`
	MinecraftArguments string      `json:"minecraftArguments,omitempty"`
	Arguments          interface{} `json:"arguments,omitempty"`
}

type Downloads struct {
	Client         DownloadInfo `json:"client"`
	Server         DownloadInfo `json:"server"`
	ClientMappings DownloadInfo `json:"client_mappings,omitempty"`
	ServerMappings DownloadInfo `json:"server_mappings,omitempty"`
}

type DownloadInfo struct {
	SHA1 string `json:"sha1"`
	Size int    `json:"size"`
	URL  string `json:"url"`
}

type Library struct {
	Name      string       `json:"name"`
	Downloads LibDownloads `json:"downloads"`
}

type LibDownloads struct {
	Artifact    Artifact    `json:"artifact,omitempty"`
	Classifiers interface{} `json:"classifiers,omitempty"`
}

type Artifact struct {
	Path string `json:"path"`
	SHA1 string `json:"sha1"`
	Size int    `json:"size"`
	URL  string `json:"url"`
}

type AssetIndex struct {
	ID        string `json:"id"`
	SHA1      string `json:"sha1"`
	Size      int    `json:"size"`
	URL       string `json:"url"`
	TotalSize int    `json:"totalSize"`
}

type AssetIndexContent struct {
	Objects map[string]AssetObject `json:"objects"`
}

type AssetObject struct {
	Hash string `json:"hash"`
	Size int    `json:"size"`
}

func getVersionManifest() (*VersionsIndexManifest, error) {
	resp, err := http.Get("https://launchermeta.mojang.com/mc/game/version_manifest.json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var manifest VersionsIndexManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}

	return &manifest, nil
}

func DownloadMinecraftVersion(version string) error {
	manifest, err := getVersionManifest()
	if err != nil {
		return err
	}

	var versionURL string
	for _, v := range manifest.Versions {
		if v.ID == version {
			versionURL = v.URL
			break
		}
	}

	if versionURL == "" {
		return fmt.Errorf("version %s not found", version)
	}

	fmt.Println("Downloading version", versionURL)

	DownloadFiles(versionURL)
	return nil
}

func downloadFile(url string, clientJarPath string) error {
	dir := filepath.Dir(clientJarPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Неправильный ответ: %s", resp.Status)
	}

	out, err := os.Create(clientJarPath)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	return err
}

func DownloadFiles(manifestURL string) error {
	resp, err := http.Get(manifestURL)
	if err != nil {
		fmt.Println("Ошибка при скачивании манифеста:", err)
		return err
	}
	defer resp.Body.Close()

	var manifest VersionDetailsManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		fmt.Println("Ошибка при разборе манифеста:", err)
		return err
	}

	basePath, err := utils.CheckDir()
	if err != nil {
		return err
	}
	clientJarPath := filepath.Join(basePath, "versions", manifest.ID, fmt.Sprintf("%s.jar", manifest.ID))
	fmt.Printf("Скачиваем основной JAR-файл: %s\n", manifest.Downloads.Client.URL)
	if err := downloadFile(manifest.Downloads.Client.URL, clientJarPath); err != nil {
		fmt.Println("Ошибка при скачивании JAR-файла клиента:", err)
		return err
	}
	fmt.Println("Скачиваем библиотеки...")
	for _, lib := range manifest.Libraries {
		if lib.Downloads.Artifact.URL != "" {
			libPath := filepath.Join(basePath, "libraries", lib.Downloads.Artifact.Path)
			fmt.Printf("Скачиваем библиотеку: %s\n", lib.Name)
			if err := downloadFile(lib.Downloads.Artifact.URL, libPath); err != nil {
				fmt.Printf("Ошибка при скачивании библиотеки %s: %v\n", lib.Name, err)
			}
		}
	}
	fmt.Println("Скачиваем индекс ресурсов...")
	assetIndexPath := filepath.Join(basePath, "assets", "indexes", fmt.Sprintf("%s.json", manifest.AssetIndex.ID))
	if err := downloadFile(manifest.AssetIndex.URL, assetIndexPath); err != nil {
		fmt.Println("Ошибка при скачивании индекса ресурсов:", err)
		return nil
	}
	assetIndexFile, err := os.ReadFile(assetIndexPath)
	if err != nil {
		fmt.Println("Ошибка при чтении индекса ресурсов:", err)
		return nil
	}

	var assetIndex AssetIndexContent
	if err := json.Unmarshal(assetIndexFile, &assetIndex); err != nil {
		fmt.Println("Ошибка при разборе индекса ресурсов:", err)
		return nil
	}

	fmt.Println("Скачиваем ресурсы...")
	for assetPath, asset := range assetIndex.Objects {
		hashPrefix := asset.Hash[:2]
		assetURL := fmt.Sprintf("https://resources.download.minecraft.net/%s/%s", hashPrefix, asset.Hash)
		assetFilePath := filepath.Join(basePath, "assets", "objects", hashPrefix, asset.Hash)

		if err := downloadFile(assetURL, assetFilePath); err != nil {
			fmt.Printf("Ошибка при скачивании ресурса %s: %v\n", assetPath, err)
		}
	}
	fmt.Println("Все файлы Minecraft успешно скачаны!")
	return nil
}
