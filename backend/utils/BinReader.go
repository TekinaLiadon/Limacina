package utils

import (
	"fmt"
	"os"
)

func BinReader(patch string) {
	data, err := os.ReadFile(patch)
	if err != nil {
		fmt.Println("Ошибка при чтении файла:", err)
		return
	}
	fmt.Println(string(data))
	return
}
