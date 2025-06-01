package auth

import (
	"crypto/md5"
	"fmt"
	"io"
	"os"
)

func GetFileInfo(filePath string) (string, error) {
	hash := md5.New()
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("Ошибка при открытии файла по пути %v: %w", filePath, err)
	}
	defer file.Close()
	_, err = io.Copy(hash, file)
	if err != nil {
		return "", fmt.Errorf("Ошибка при копировании файла по пути %v: %w", filePath, err)
	}
	md5 := fmt.Sprintf("%x", hash.Sum(nil))
	return md5, nil
}
