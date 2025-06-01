package auth

import (
	"Limacina/backend/utils"
	"context"
	"encoding/json"
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"net/http"
	"os"
	"path/filepath"
)

func GetFileList(ctx context.Context) (string, error) {
	resp, err := http.Get("http://85.193.85.49:3005/api/list")
	if err != nil {
		return "", fmt.Errorf("Не удалось получить список файлов: %w", err)
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("Не удалось декодировать JSON: %w", err)
	}

	jsonData, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("Не удалось маршалировать JSON: %w", err)
	}
	var data interface{}
	if err := json.Unmarshal(jsonData, &data); err != nil {
		return "", fmt.Errorf("Ошибка при чтении JSON: %w", err)
	}
	res := data.(map[string]interface{})
	core, err := utils.CheckDir()
	if err != nil {
		return "", err
	}
	core = core + "/test/" // name dir
	sliceKey := []string{}
	for key, val := range res {
		_, err := os.Stat(core + key)
		if os.IsNotExist(err) {
			sliceKey = append(sliceKey, key)
		} else {
			hash, err := GetFileInfo(core + key)
			if err != nil {
				return "", err
			}
			if hash == val {
				continue
			} else {
				sliceKey = append(sliceKey, key)
			}
		}

	}
	runtime.EventsEmit(ctx, "totalFile", len(sliceKey))
	count := 0
	for _, val := range sliceKey {
		count += 1
		runtime.EventsEmit(ctx, "numberFile",
			map[string]interface{}{
				"file":   filepath.Base(val),
				"number": count,
			})
		_, err := GetFile(core+val, val, ctx)
		if err != nil {
			return "", err
		}
	}
	return string(jsonData), nil
}
